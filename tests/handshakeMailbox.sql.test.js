import { beforeAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/20261119_handshake_mailbox.sql", import.meta.url), "utf8");
const box = (c) => c.repeat(43);
const payload = "A".repeat(30);
let db;
const as = async (role, q, params) => {
  await db.exec(`reset role; set role ${role}`);
  try { return await db.query(q, params); } finally { await db.exec("reset role"); }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; grant usage on schema public to anon, authenticated; create table public.event_attendees(id int);");
  await db.exec(sql);
}, 30000);

describe("handshake mailbox", () => {
  it("lets a signed-out phone post and take, and deletes on take", async () => {
    await as("anon", "select public.handshake_post($1,$2)", [box("a"), payload]);
    const first = await as("anon", "select * from public.handshake_take($1)", [[box("a"), box("b")]]);
    expect(first.rows).toEqual([{ box: box("a"), payload }]);
    const again = await as("anon", "select * from public.handshake_take($1)", [[box("a")]]);
    expect(again.rows).toEqual([]);
  });

  it("gives nobody direct access to the table", async () => {
    await expect(as("anon", "select * from public.handshake_mailbox")).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", "select * from public.handshake_mailbox")).rejects.toThrow(/permission denied/);
    await expect(as("anon", "insert into public.handshake_mailbox (box,payload) values ($1,$2)", [box("c"), payload])).rejects.toThrow(/permission denied/);
  });

  it("rejects malformed boxes and payloads", async () => {
    await expect(as("anon", "select public.handshake_post($1,$2)", ["short", payload])).rejects.toThrow(/invalid/);
    await expect(as("anon", "select public.handshake_post($1,$2)", [box("d"), "<script>alert(1)</script>xxxxx"])).rejects.toThrow(/invalid/);
    await expect(as("anon", "select * from public.handshake_take($1)", [["bad"]])).rejects.toThrow(/invalid/);
    await expect(as("anon", "select * from public.handshake_take($1)", [Array(101).fill(box("e"))])).rejects.toThrow(/invalid/);
  });

  it("limits a box to 20 waiting messages", async () => {
    for (let i = 0; i < 20; i++) await as("anon", "select public.handshake_post($1,$2)", [box("f"), payload]);
    await expect(as("anon", "select public.handshake_post($1,$2)", [box("f"), payload])).rejects.toThrow(/full/);
  });

  it("deletes messages older than 7 days", async () => {
    await db.exec(`insert into public.handshake_mailbox (box,payload,created_at) values ('${box("g")}','${payload}', now() - interval '8 days')`);
    const r = await as("anon", "select * from public.handshake_take($1)", [[box("g")]]);
    expect(r.rows).toEqual([]);
    expect((await db.query("select count(*)::int n from public.handshake_mailbox where box=$1", [box("g")])).rows[0].n).toBe(0);
  });

  it("refuses to run in the wrong project", async () => {
    const other = new PGlite();
    await other.exec("create role anon; create role authenticated;");
    await expect(other.exec(sql)).rejects.toThrow(/WRONG PROJECT/);
  });
});
