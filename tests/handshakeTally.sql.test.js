import { beforeAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/20261120_handshake_tally.sql", import.meta.url), "utf8");
let db;
const as = async (role, q, params, admin = false) => {
  await db.exec(`reset role; set test.admin = '${admin}'; set role ${role}`);
  try { return await db.query(q, params); } finally { await db.exec("reset role"); }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    grant usage on schema public to anon, authenticated;
    create table public.event_attendees(id int);
    create function public.is_admin() returns boolean language sql stable as $$ select current_setting('test.admin', true) = 'true' $$;
    grant execute on function public.is_admin() to anon, authenticated;`);
  await db.exec(sql);
}, 30000);

describe("handshake tally", () => {
  it("adds one to today's total for a known kind, signed out", async () => {
    await as("anon", "select public.handshake_count('card_made')");
    await as("anon", "select public.handshake_count('card_made')");
    await as("authenticated", "select public.handshake_count('ask_sent')");
    const rows = (await db.query("select kind, n from public.handshake_tally order by kind")).rows;
    expect(rows).toEqual([{ kind: "ask_sent", n: 1 }, { kind: "card_made", n: 2 }]);
  });

  it("stores nothing but day, kind and a number", async () => {
    const cols = (await db.query("select column_name from information_schema.columns where table_name = 'handshake_tally' order by ordinal_position")).rows.map((r) => r.column_name);
    expect(cols).toEqual(["day", "kind", "n"]);
  });

  it("rejects unknown kinds", async () => {
    await expect(as("anon", "select public.handshake_count('alex@example.com')")).rejects.toThrow(/invalid/);
  });

  it("gives no direct table access", async () => {
    await expect(as("anon", "select * from public.handshake_tally")).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", "update public.handshake_tally set n = 0")).rejects.toThrow(/permission denied/);
  });

  it("lets only admins read totals", async () => {
    await expect(as("anon", "select * from public.get_handshake_tally()")).rejects.toThrow(/permission denied/);
    expect((await as("authenticated", "select * from public.get_handshake_tally()")).rows).toEqual([]);
    expect((await as("authenticated", "select * from public.get_handshake_tally()", [], true)).rows.length).toBe(2);
  });

  it("refuses to run in the wrong project", async () => {
    const other = new PGlite();
    await other.exec("create role anon; create role authenticated;");
    await expect(other.exec(sql)).rejects.toThrow(/WRONG PROJECT/);
  });
});
