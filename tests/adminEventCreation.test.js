import { describe, expect, it, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ADMIN_STATE,
  fetchIsAdmin,
  renderAdminGate,
  resolveAdminAccess,
  resetAdminCache,
} from "../assets/js/adminAccess.js";

// ---------------------------------------------------------------------------
// Source of truth: admin membership lives in the database (public.admins),
// checked via the public.is_admin() RPC. The client asks the server; it keeps
// NO email allowlist. These tests model the server decision from the membership
// table and verify the client renders from the server result.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "..");
const MIGRATION = fs.readFileSync(
  path.join(REPO, "supabase/migrations/026_admin_membership_and_event_creation.sql"),
  "utf8"
);
const ADMIN_ACCESS_SRC = fs.readFileSync(
  path.join(REPO, "assets/js/adminAccess.js"),
  "utf8"
);

// A tiny in-memory model of the DB membership + policy the migration defines.
function makeDb(initialAdminUserIds = []) {
  const admins = new Set(initialAdminUserIds);
  return {
    addAdmin: (uid) => admins.add(uid),      // INSERT INTO public.admins
    removeAdmin: (uid) => admins.delete(uid), // DELETE FROM public.admins
    // Mirror of public.is_admin(): EXISTS(SELECT 1 FROM admins WHERE user_id = auth.uid())
    isAdmin: (uid) => (uid == null ? false : admins.has(uid)),
    // Mirror of the events INSERT WITH CHECK: is_admin() AND created_by = profile
    canCreateEvent: ({ uid, createdBy, currentProfileId }) =>
      admins.has(uid) && createdBy != null && createdBy === currentProfileId,
  };
}

// A fake supabase whose rpc('is_admin') consults the DB model for a given uid.
function makeSupabase(db, uid, { failing = false } = {}) {
  return {
    rpc: vi.fn(async (name) => {
      if (name !== "is_admin") throw new Error("unexpected rpc: " + name);
      if (failing) return { data: null, error: { message: "boom" } };
      return { data: db.isAdmin(uid), error: null };
    }),
  };
}

function fakeEl() {
  return { style: { display: "unset" } };
}

beforeEach(() => resetAdminCache());

// ---------------------------------------------------------------------------
// Migration: seeding + shape
// ---------------------------------------------------------------------------
describe("migration 026 — seeds initial admins by stable account identity", () => {
  it("seeds the two current administrators from their auth accounts", () => {
    expect(MIGRATION).toContain("dmhamilton1@live.com");
    expect(MIGRATION).toContain("deckerdb26354@gmail.com");
    // Seeded by resolving auth.users id (stable identity), not by storing email.
    expect(MIGRATION).toMatch(/FROM auth\.users|SELECT id INTO uid FROM auth\.users/);
    expect(MIGRATION).toMatch(/INSERT INTO public\.admins/);
  });

  it("fails safely (raises) if a seed email has no authenticated account", () => {
    expect(MIGRATION).toMatch(/RAISE EXCEPTION[\s\S]*no authenticated account/i);
  });

  it("membership table is keyed by auth.users id (stable), not email", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.admins/);
    expect(MIGRATION).toMatch(/user_id\s+uuid\s+PRIMARY KEY\s+REFERENCES auth\.users\(id\)/);
    // No email column persisted for membership.
    expect(MIGRATION).not.toMatch(/\bemail\s+text\b/);
  });

  it("is_admin() is SECURITY DEFINER with an explicit safe search_path", () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.is_admin\(\)/);
    expect(MIGRATION).toMatch(/SECURITY DEFINER/);
    expect(MIGRATION).toMatch(/SET search_path = public, pg_catalog/);
  });

  it("restricts event INSERT to admins and preserves other event policies", () => {
    expect(MIGRATION).toMatch(/CREATE POLICY "Admins can create events"[\s\S]*FOR INSERT/);
    expect(MIGRATION).toMatch(/public\.is_admin\(\)\s*\n?\s*AND created_by = current_profile_id\(\)/);
    // Does NOT touch SELECT/UPDATE/DELETE.
    expect(MIGRATION).not.toMatch(/FOR SELECT/);
    expect(MIGRATION).not.toMatch(/FOR UPDATE/);
    expect(MIGRATION).not.toMatch(/FOR DELETE/);
  });

  it("prevents ordinary users from reading/modifying the admin list", () => {
    expect(MIGRATION).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON public\.admins FROM anon, authenticated/);
  });

  it("does NOT hard-code an email allowlist inside is_admin()", () => {
    // The function body must query the table, not compare emails.
    const fnMatch = MIGRATION.match(/CREATE OR REPLACE FUNCTION public\.is_admin\(\)[\s\S]*?\$\$;/);
    expect(fnMatch).toBeTruthy();
    const body = fnMatch[0];
    expect(body).toMatch(/FROM public\.admins/);
    expect(body).not.toMatch(/@/); // no email literals in the predicate
  });
});

// ---------------------------------------------------------------------------
// No duplicated allowlists
// ---------------------------------------------------------------------------
describe("no duplicated hard-coded allowlists", () => {
  it("client adminAccess.js contains no email allowlist and no ADMIN_EMAILS", () => {
    expect(ADMIN_ACCESS_SRC).not.toMatch(/ADMIN_EMAILS/);
    expect(ADMIN_ACCESS_SRC).not.toMatch(/@live\.com|@gmail\.com/);
    // It must derive admin status from the server RPC.
    expect(ADMIN_ACCESS_SRC).toMatch(/rpc\(["']is_admin["']\)/);
  });

  it("client no longer exports an email-based isAdminUser/getUserEmail", () => {
    expect(ADMIN_ACCESS_SRC).not.toMatch(/export function isAdminUser/);
    expect(ADMIN_ACCESS_SRC).not.toMatch(/export function getUserEmail/);
  });
});

// ---------------------------------------------------------------------------
// Backend decision (modeled on the membership table + INSERT policy)
// ---------------------------------------------------------------------------
describe("backend event-creation authorization (membership-driven)", () => {
  it("both seeded admins can create; non-admin cannot", () => {
    const db = makeDb(["uid-admin-1", "uid-admin-2"]);
    expect(db.canCreateEvent({ uid: "uid-admin-1", createdBy: "p1", currentProfileId: "p1" })).toBe(true);
    expect(db.canCreateEvent({ uid: "uid-admin-2", createdBy: "p2", currentProfileId: "p2" })).toBe(true);
    expect(db.canCreateEvent({ uid: "uid-attendee", createdBy: "p3", currentProfileId: "p3" })).toBe(false);
  });

  it("anon (no uid) create attempt → denied", () => {
    const db = makeDb(["uid-admin-1"]);
    expect(db.isAdmin(null)).toBe(false);
    expect(db.canCreateEvent({ uid: null, createdBy: "p", currentProfileId: "p" })).toBe(false);
  });

  it("a future admin added to the table gains creation — with NO code change", () => {
    const db = makeDb(["uid-admin-1"]);
    expect(db.canCreateEvent({ uid: "uid-future", createdBy: "pf", currentProfileId: "pf" })).toBe(false);
    db.addAdmin("uid-future"); // INSERT INTO public.admins — a data operation only
    expect(db.canCreateEvent({ uid: "uid-future", createdBy: "pf", currentProfileId: "pf" })).toBe(true);
  });

  it("a removed admin loses creation permission", () => {
    const db = makeDb(["uid-admin-1"]);
    expect(db.canCreateEvent({ uid: "uid-admin-1", createdBy: "p1", currentProfileId: "p1" })).toBe(true);
    db.removeAdmin("uid-admin-1"); // DELETE FROM public.admins
    expect(db.canCreateEvent({ uid: "uid-admin-1", createdBy: "p1", currentProfileId: "p1" })).toBe(false);
  });

  it("admin spoofing another profile's created_by → denied (ownership invariant)", () => {
    const db = makeDb(["uid-admin-1"]);
    expect(db.canCreateEvent({ uid: "uid-admin-1", createdBy: "someone-else", currentProfileId: "admin-profile" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client: derives from the server result (fetchIsAdmin → is_admin RPC)
// ---------------------------------------------------------------------------
describe("fetchIsAdmin — server-derived, fail-closed, cached", () => {
  it("returns true only when the server says the uid is an admin", async () => {
    const db = makeDb(["uid-admin-1"]);
    expect(await fetchIsAdmin(makeSupabase(db, "uid-admin-1"))).toBe(true);
    resetAdminCache();
    expect(await fetchIsAdmin(makeSupabase(db, "uid-attendee"))).toBe(false);
  });

  it("fails CLOSED (false) when the RPC errors", async () => {
    const db = makeDb(["uid-admin-1"]);
    const sb = makeSupabase(db, "uid-admin-1", { failing: true });
    expect(await fetchIsAdmin(sb)).toBe(false);
  });

  it("caches the result (single RPC call per session)", async () => {
    const db = makeDb(["uid-admin-1"]);
    const sb = makeSupabase(db, "uid-admin-1");
    await fetchIsAdmin(sb);
    await fetchIsAdmin(sb);
    expect(sb.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("renderAdminGate — safe state rendering (no flash)", () => {
  it("loading → everything hidden (no admin content flash)", () => {
    const gateEl = fakeEl(), contentEl = fakeEl(), restrictedEl = fakeEl();
    renderAdminGate(ADMIN_STATE.LOADING, { gateEl, contentEl, restrictedEl });
    expect(gateEl.style.display).toBe("none");
    expect(contentEl.style.display).toBe("none");
    expect(restrictedEl.style.display).toBe("none");
  });

  it("unauthenticated → gate only", () => {
    const gateEl = fakeEl(), contentEl = fakeEl(), restrictedEl = fakeEl();
    renderAdminGate(ADMIN_STATE.UNAUTHENTICATED, { gateEl, contentEl, restrictedEl });
    expect(gateEl.style.display).toBe("");
    expect(contentEl.style.display).toBe("none");
    expect(restrictedEl.style.display).toBe("none");
  });

  it("forbidden → restricted only; content stays hidden", () => {
    const gateEl = fakeEl(), contentEl = fakeEl(), restrictedEl = fakeEl();
    renderAdminGate(ADMIN_STATE.FORBIDDEN, { gateEl, contentEl, restrictedEl });
    expect(restrictedEl.style.display).toBe("");
    expect(contentEl.style.display).toBe("none");
  });

  it("granted → content only", () => {
    const gateEl = fakeEl(), contentEl = fakeEl(), restrictedEl = fakeEl();
    renderAdminGate(ADMIN_STATE.GRANTED, { gateEl, contentEl, restrictedEl });
    expect(contentEl.style.display).toBe("");
    expect(gateEl.style.display).toBe("none");
    expect(restrictedEl.style.display).toBe("none");
  });
});

describe("resolveAdminAccess — end-to-end client gate from server result", () => {
  it("signed-out → 'unauthenticated', content hidden", async () => {
    const db = makeDb(["uid-admin-1"]);
    const contentEl = fakeEl(), gateEl = fakeEl(), restrictedEl = fakeEl();
    const state = await resolveAdminAccess(makeSupabase(db, null), null, { gateEl, contentEl, restrictedEl });
    expect(state).toBe("unauthenticated");
    expect(contentEl.style.display).toBe("none");
  });

  it("signed-in non-admin → 'forbidden', creation content never shown", async () => {
    const db = makeDb(["uid-admin-1"]);
    const contentEl = fakeEl(), gateEl = fakeEl(), restrictedEl = fakeEl();
    const session = { user: { id: "uid-attendee" } };
    const state = await resolveAdminAccess(makeSupabase(db, "uid-attendee"), session, { gateEl, contentEl, restrictedEl });
    expect(state).toBe("forbidden");
    expect(contentEl.style.display).toBe("none");
    expect(restrictedEl.style.display).toBe("");
  });

  it("signed-in admin → 'granted', creation content revealed", async () => {
    const db = makeDb(["uid-admin-1"]);
    const contentEl = fakeEl(), gateEl = fakeEl(), restrictedEl = fakeEl();
    const session = { user: { id: "uid-admin-1" } };
    const state = await resolveAdminAccess(makeSupabase(db, "uid-admin-1"), session, { gateEl, contentEl, restrictedEl });
    expect(state).toBe("granted");
    expect(contentEl.style.display).toBe("");
  });

  it("server error while signed in → fail closed to 'forbidden' (no content)", async () => {
    const db = makeDb(["uid-admin-1"]);
    const contentEl = fakeEl(), gateEl = fakeEl(), restrictedEl = fakeEl();
    const session = { user: { id: "uid-admin-1" } };
    const sb = makeSupabase(db, "uid-admin-1", { failing: true });
    const state = await resolveAdminAccess(sb, session, { gateEl, contentEl, restrictedEl });
    expect(state).toBe("forbidden");
    expect(contentEl.style.display).toBe("none");
  });
});
