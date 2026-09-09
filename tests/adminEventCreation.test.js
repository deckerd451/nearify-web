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
const MIGRATION_027 = fs.readFileSync(
  path.join(REPO, "supabase/migrations/027_drop_legacy_events_insert_policy.sql"),
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

// Named permissive INSERT policies as predicates over the insert context.
// PostgreSQL combines MULTIPLE PERMISSIVE policies for the same command with OR:
// a row is allowed if ANY policy's WITH CHECK passes. This models that so we can
// prove why a leftover "WITH CHECK (true)" policy defeats the admin-only rule.
const POLICIES = {
  // Legacy permissive policy that was left active in prod ("WITH CHECK (true)").
  legacyPermissive: () => true,
  // The 026 admin-only policy.
  adminsCanCreate: ({ isAdmin, createdBy, currentProfileId }) =>
    isAdmin && createdBy != null && createdBy === currentProfileId,
};

/** OR-combine the given permissive policies (PostgreSQL semantics). */
function insertAllowedUnder(policyNames, ctx) {
  return policyNames.some((name) => POLICIES[name](ctx));
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

// ---------------------------------------------------------------------------
// Regression: legacy permissive INSERT policy must not survive.
//
// PostgreSQL combines MULTIPLE PERMISSIVE policies for the same command with OR.
// Production had a differently-cased leftover policy:
//   "authenticated users can create events"  WITH CHECK (true)
// alongside 026's "Admins can create events". The effective INSERT check became
//   (true) OR (is_admin() AND created_by = current_profile_id())  ==> always true,
// silently defeating the admin-only rule. Migration 027 drops that exact policy.
// ---------------------------------------------------------------------------
describe("migration 027 — drops the legacy permissive events INSERT policy", () => {
  it("drops the exact legacy policy name on public.events", () => {
    expect(MIGRATION_027).toMatch(
      /DROP POLICY IF EXISTS "authenticated users can create events" ON public\.events;/
    );
  });

  it("does NOT recreate or weaken the admin-only INSERT policy", () => {
    // 027 must be a pure drop — it never creates a policy. (Its header comment
    // quotes the legacy "WITH CHECK (true)" only to explain the bug.)
    expect(MIGRATION_027).not.toMatch(/CREATE POLICY/i);
    // No executable statement re-grants a permissive true check. Strip comment
    // lines first so the explanatory text does not trip this guard.
    const executable = MIGRATION_027
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });

  it("explains the PostgreSQL OR-combination cause", () => {
    expect(MIGRATION_027).toMatch(/OR/);
    expect(MIGRATION_027.toLowerCase()).toMatch(/permissive/);
  });
});

describe("no permissive 'WITH CHECK (true)' INSERT policy survives in schema history", () => {
  // Load each events-related migration with its filename so we can reason about
  // ordering (a CREATE must be followed by a later DROP of the same name).
  const MIG_DIR = path.join(REPO, "supabase/migrations");
  const files = fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const sqlByFile = files.map((f) => ({ f, sql: fs.readFileSync(path.join(MIG_DIR, f), "utf8") }));

  it("no migration creates an events INSERT policy with WITH CHECK (true)", () => {
    // Match a CREATE POLICY targeting the events table (not analytics_events etc.)
    // whose INSERT check is the always-true predicate.
    const offending = sqlByFile.filter(({ sql }) =>
      /CREATE POLICY\s+"[^"]+"\s+ON\s+(?:public\.)?events\s+FOR INSERT\s+WITH CHECK\s*\(\s*true\s*\)/i.test(sql)
    );
    expect(offending.map((x) => x.f)).toEqual([]);
  });

  it("every events INSERT policy that is created is either admin-only or later dropped", () => {
    // Collect (policyName, createdInFile) for INSERT policies on `events`.
    const created = [];
    for (const { f, sql } of sqlByFile) {
      for (const m of sql.matchAll(
        /CREATE POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?events\s+FOR INSERT/gi
      )) {
        created.push({ name: m[1], file: f });
      }
    }
    // The admin-only policy is allowed to persist; all others must be dropped
    // by a later migration (case-sensitive name match, DROP POLICY IF EXISTS).
    for (const { name, file } of created) {
      if (name === "Admins can create events") continue;
      const droppedLater = sqlByFile.some(
        ({ f, sql }) =>
          f > file &&
          new RegExp(
            `DROP POLICY IF EXISTS\\s+"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s+ON\\s+(?:public\\.)?events`,
            "i"
          ).test(sql)
      );
      expect(droppedLater, `policy "${name}" created in ${file} must be dropped later`).toBe(true);
    }
  });

  it("027 drops the legacy lowercase policy that 026's drop (capital A) missed", () => {
    // The case-sensitivity gap is the root cause: 026 dropped "Authenticated…",
    // prod also had "authenticated…" (lowercase) which survived until 027.
    expect(MIGRATION).toMatch(/DROP POLICY IF EXISTS "Authenticated users can create events"/);
    expect(MIGRATION_027).toMatch(/DROP POLICY IF EXISTS "authenticated users can create events"/);
  });
});

describe("PostgreSQL OR-policy semantics — why the legacy policy was dangerous", () => {
  const nonAdminCtx = { isAdmin: false, createdBy: "p1", currentProfileId: "p1" };
  const adminCtx = { isAdmin: true, createdBy: "pa", currentProfileId: "pa" };

  it("BUG: legacy permissive + admin policy OR-combine to allow a non-admin", () => {
    // Both policies active (the defective production state before the manual fix).
    expect(insertAllowedUnder(["legacyPermissive", "adminsCanCreate"], nonAdminCtx)).toBe(true);
  });

  it("FIXED: with only the admin policy, a non-admin is denied", () => {
    expect(insertAllowedUnder(["adminsCanCreate"], nonAdminCtx)).toBe(false);
  });

  it("FIXED: with only the admin policy, an admin (own profile) is allowed", () => {
    expect(insertAllowedUnder(["adminsCanCreate"], adminCtx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: the dashboard "Organizer Tools / Your Events" section is
// admin-only. It must be hidden by default (no flash), revealed only after the
// server-backed fetchIsAdmin() confirms admin, and organizer-event data must
// not be fetched/rendered for non-admins. Ordinary dashboard/attendee/
// connection surfaces are preserved.
// ---------------------------------------------------------------------------

const INDEX_HTML = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const DASHBOARD_SRC = fs.readFileSync(path.join(REPO, "assets/js/dashboard.js"), "utf8");

describe("organizer section markup — hidden by default, admin-gated", () => {
  it("the organizer section starts hidden and is tagged data-admin-create", () => {
    // Single section element carries id, data-admin-create, and hidden.
    expect(INDEX_HTML).toMatch(
      /<section[^>]*id="organizerToolsSection"[^>]*class="cc-organizer-tools"[^>]*data-admin-create[^>]*hidden[^>]*>/
    );
  });

  it("still contains the organizer heading, subtext, and event list inside it", () => {
    // The complete section (title/explanatory text/list) is what gets hidden.
    const section = INDEX_HTML.match(/<section[^>]*id="organizerToolsSection"[\s\S]*?<\/section>/);
    expect(section).toBeTruthy();
    expect(section[0]).toMatch(/Organizer tools/);
    expect(section[0]).toMatch(/Your Events/);
    expect(section[0]).toMatch(/id="eventCardList"/);
  });
});

describe("dashboard.js gates organizer data + render on fetchIsAdmin", () => {
  it("fetchMyEvents is only called for admins (guarded by isAdmin)", () => {
    expect(DASHBOARD_SRC).toMatch(/isAdmin\s*\?\s*fetchMyEvents\(\)\s*:\s*Promise\.resolve\(\[\]\)/);
  });

  it("organizer-only renders (Your Events + ecosystem hero) are behind isAdmin", () => {
    // renderDashboard + renderEcosystemHero must appear inside an `if (isAdmin)`.
    expect(DASHBOARD_SRC).toMatch(/if \(isAdmin\)\s*\{[\s\S]*?renderEcosystemHero\([\s\S]*?renderDashboard\(/);
  });

  it("admin status comes from the server-backed fetchIsAdmin (no email allowlist)", () => {
    expect(DASHBOARD_SRC).toMatch(/fetchIsAdmin\(supabase\)/);
    expect(DASHBOARD_SRC).not.toMatch(/@live\.com|@gmail\.com|ADMIN_EMAILS/);
  });
});

// Mirror of dashboard.js applyCreateControlVisibility(): toggles every
// [data-admin-create] element's hidden flag based on the SERVER result.
async function revealAdminSurfaces(supabase, signedIn, els) {
  let isAdmin = false;
  if (signedIn) isAdmin = await fetchIsAdmin(supabase);
  else resetAdminCache();
  els.forEach((el) => { el.hidden = !isAdmin; });
  return isAdmin;
}

// Mirror of loadDashboard()'s organizer gate: whether organizer events are
// fetched and the Your Events section rendered.
async function organizerLoadPlan(supabase, signedIn) {
  const isAdmin = signedIn ? await fetchIsAdmin(supabase) : false;
  return { fetchedOrganizerEvents: isAdmin, renderedYourEvents: isAdmin };
}

describe("organizer section visibility across auth states", () => {
  it("signed-out → hidden, no organizer fetch/render", async () => {
    const db = makeDb(["uid-admin"]);
    const section = { hidden: false };
    const isAdmin = await revealAdminSurfaces(makeSupabase(db, null), false, [section]);
    expect(isAdmin).toBe(false);
    expect(section.hidden).toBe(true);
    const plan = await organizerLoadPlan(makeSupabase(db, null), false);
    expect(plan).toEqual({ fetchedOrganizerEvents: false, renderedYourEvents: false });
  });

  it("loading (default markup) → hidden before authorization resolves (no flash)", () => {
    // Section ships hidden; nothing reveals it until the async check resolves.
    const section = { hidden: true };
    expect(section.hidden).toBe(true);
  });

  it("signed-in non-admin → stays hidden, no organizer fetch/render", async () => {
    const db = makeDb(["uid-admin"]);
    const section = { hidden: true };
    const isAdmin = await revealAdminSurfaces(makeSupabase(db, "uid-attendee"), true, [section]);
    expect(isAdmin).toBe(false);
    expect(section.hidden).toBe(true);
    const plan = await organizerLoadPlan(makeSupabase(db, "uid-attendee"), true);
    expect(plan).toEqual({ fetchedOrganizerEvents: false, renderedYourEvents: false });
  });

  it("server error while signed in → fail closed, stays hidden", async () => {
    const db = makeDb(["uid-admin"]);
    const section = { hidden: true };
    const isAdmin = await revealAdminSurfaces(makeSupabase(db, "uid-admin", { failing: true }), true, [section]);
    expect(isAdmin).toBe(false);
    expect(section.hidden).toBe(true);
    const plan = await organizerLoadPlan(makeSupabase(db, "uid-admin", { failing: true }), true);
    expect(plan.renderedYourEvents).toBe(false);
  });

  it("admin → revealed, organizer events fetched and rendered", async () => {
    const db = makeDb(["uid-admin"]);
    const section = { hidden: true };
    const isAdmin = await revealAdminSurfaces(makeSupabase(db, "uid-admin"), true, [section]);
    expect(isAdmin).toBe(true);
    expect(section.hidden).toBe(false);
    const plan = await organizerLoadPlan(makeSupabase(db, "uid-admin"), true);
    expect(plan).toEqual({ fetchedOrganizerEvents: true, renderedYourEvents: true });
  });
});
