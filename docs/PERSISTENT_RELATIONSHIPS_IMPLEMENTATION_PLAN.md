# Persistent Relationships — Implementation Plan

**Date:** 2026-06-08  
**Design source:** `docs/PERSISTENT_CONNECTIONS_DESIGN.md`  
**Repo:** `nearify-web` — confirmed owner of all Supabase migrations, RPCs, and RLS policies  
**Status:** Pre-implementation. No code has been modified.

---

## Critical Pre-Implementation Unknowns

These must be resolved before any migration is applied to the live database. They are not blockers for writing the migration files, but they are hard blockers for deploying them.

### Unknown 1: Migration deployment path

`supabase/config.toml` does not exist in this repo. This means:

- The Supabase CLI is not linked to the live project (`unndeygygkgodmmdnlup.supabase.co`).
- `supabase db push` cannot be used as-is.
- There is no automated migration runner visible in `.github/workflows/ci.yml` — CI validates JS syntax, tests, and HTML checks only. It does not apply migrations.

**Resolution required:** Confirm with the team how migrations 001–015 were applied to the live project. Options are:
1. Manual copy-paste into the Supabase Studio SQL editor (most likely, given no config.toml).
2. Supabase CLI run locally with `supabase link` and `supabase db push` outside of this repo's tracked state.
3. A separate deployment repo or script not visible here.

The manual SQL checklist in §7 below assumes option 1 until confirmed otherwise.

### Unknown 2: Who calls `compute_interaction_intelligence()`

A codebase search across all `.js`, `.html`, `.ts`, and `.py` files in `nearify-web` returns **zero results** for `compute_interaction_intelligence`. It is defined in `supabase/migrations/002_rls_and_functions.sql:116` but is not called from the web layer.

This function processes all attendee pairs at an event and writes `interaction_intelligence` rows. It must be called from somewhere — either:
- The **iOS app** (most likely — the app has BLE/proximity signals and would trigger intelligence computation after an event).
- A **Supabase Edge Function** not currently in this repo (only `og-image` is present).
- A **manual admin trigger** via Supabase Studio's RPC runner.
- A **cron job or webhook** outside this codebase.

**Resolution required:** Before migration 019 is applied (which patches this function), confirm where it is called from, so the patch can be tested end-to-end and the caller is not broken by the behavior change (suppression → re-engagement update for confirmed pairs, `re_engaged` type addition).

### Unknown 3: Whether iOS calls `get_my_intelligence()` or `compute_interaction_intelligence()`

`get_my_intelligence()` is called in `assets/js/intelligence.js:530`. The iOS app may also call it independently to render its own intelligence cards. The patched version of this function adds a `relationship_status` field to each returned row.

- If iOS reads the full row and ignores unknown fields, the patch is safe.
- If iOS has strict schema validation or destructuring that rejects unknown fields, the patch breaks the iOS intelligence view.

**Resolution required:** Check the iOS codebase for calls to `get_my_intelligence` before deploying migration 019.

---

## 1. Migration Sequence

Five migration files, applied in strict order. Each is self-contained and rollbackable independently.

### 016 — `extend_intelligence_type`

**Purpose:** Add `re_engaged` to the `interaction_intelligence.type` CHECK constraint.

**Must precede 019.** Migration 019 modifies `compute_interaction_intelligence()` to write `re_engaged` rows. If 016 has not been applied, those INSERTs will fail the CHECK constraint.

**Exact SQL change:**
```sql
ALTER TABLE interaction_intelligence
  DROP CONSTRAINT interaction_intelligence_type_check,
  ADD CONSTRAINT interaction_intelligence_type_check
    CHECK (type IN ('recommended', 'missed', 'follow_up', 're_engaged'));
```

**Risk:** Low. Additive change to a CHECK constraint. Existing rows are unaffected. No lock beyond the brief DDL.

**Verify after applying:**
```sql
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'interaction_intelligence_type_check';
```
Expected: `check_clause` includes `'re_engaged'`.

---

### 017 — `relationships_table`

**Purpose:** Create the `relationships` table with all indexes and RLS policies.

**Columns:**
- `id` uuid PK
- `profile_a_id` uuid NOT NULL FK → profiles(id) — canonical lower UUID of the pair
- `profile_b_id` uuid NOT NULL FK → profiles(id) — canonical higher UUID of the pair
- `status` text NOT NULL CHECK (proposed|confirmed|snoozed)
- `proposed_by_id` uuid NULLABLE FK → profiles(id) — first confirmer; NULL if snoozed before any confirmation
- `source_event_id` uuid NOT NULL FK → events(id)
- `source_intelligence_id` uuid NULLABLE FK → interaction_intelligence(id)
- `first_encounter_at` timestamptz NOT NULL
- `confirmed_at` timestamptz NULLABLE
- `last_encounter_at` timestamptz NULLABLE
- `encounter_count` int NOT NULL DEFAULT 1
- `snoozed_by_a` boolean NOT NULL DEFAULT false
- `snoozed_by_b` boolean NOT NULL DEFAULT false
- `created_at` timestamptz NOT NULL DEFAULT now()

**Canonical ordering invariant:** `profile_a_id < profile_b_id` (UUID lexicographic). Enforced in `confirm_relationship()` RPC at write time — not a DB constraint, but consistently applied by all writers.

**Unique constraint:** `UNIQUE (profile_a_id, profile_b_id)` — one row per undirected pair, ever.

**Indexes:**
- `idx_relationships_a` on `(profile_a_id, status)`
- `idx_relationships_b` on `(profile_b_id, status)`
- `idx_relationships_source_event` on `(source_event_id)`
- `idx_relationships_last_encounter` on `(last_encounter_at)`
- `idx_relationships_encounter_count` on `(encounter_count)`

**RLS policies:**
- **SELECT:** `profile_a_id = current_profile_id() OR profile_b_id = current_profile_id()`
- **INSERT:** `proposed_by_id = current_profile_id()` AND (`profile_a_id = current_profile_id()` OR `profile_b_id = current_profile_id()`)
- **UPDATE:** (`profile_a_id = current_profile_id()` OR `profile_b_id = current_profile_id()`) — permits snooze flag and confirmation updates from either party. The `compute_interaction_intelligence()` health-column update runs as `SECURITY DEFINER` and bypasses RLS.
- **No DELETE policy** — rows are never deleted.

**Risk:** Low. New table with no dependencies on existing tables except FKs to `profiles`, `events`, `interaction_intelligence`. Does not alter any existing table.

**Verify after applying:**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'relationships'
ORDER BY ordinal_position;
```

---

### 018 — `relationship_rpcs`

**Purpose:** Create three new RPCs and one new read RPC.

#### `confirm_relationship(p_other_profile_id, p_source_event_id, p_source_intel_id)`

Handles both the first confirmation (INSERT with `status = 'proposed'`) and the second confirmation (UPDATE to `status = 'confirmed'`). Idempotent: returns the existing row if already proposed or confirmed.

**Logic:**
1. Resolve `current_profile_id()`. Raise if null.
2. Guard: `current_profile_id() ≠ p_other_profile_id`.
3. Compute canonical pair: `a = LEAST(current, other)`, `b = GREATEST(current, other)`.
4. Check for existing row:
   - If none: INSERT with `status = 'proposed'`, `proposed_by_id = current`, `first_encounter_at` from earliest `interaction_events` for this pair.
   - If `proposed` and `proposed_by_id ≠ current`: UPDATE `status = 'confirmed'`, `confirmed_at = now()`.
   - If `proposed` and `proposed_by_id = current`: return existing row (idempotent, already confirmed by this party).
   - If `confirmed`: return existing row (idempotent).
   - If `snoozed`: clear snooze flag for current party, then apply first/second confirmation logic above.

**Returns:** `{ relationship_id, status, first_encounter_at, confirmed_at }`

#### `snooze_relationship(p_other_profile_id, p_source_event_id)`

Sets the snooze flag for the current profile on the pair's row. Inserts a `proposed` row with the snooze flag set if no row exists yet.

**Returns:** void

#### `get_relationship_context(p_other_profile_id)`

Reads the relationship state between the current authenticated profile and any other profile. Safe to call when unauthenticated — returns encounter history with `relationship_status = null`.

**Returns JSONB:**
```
{
  relationship_status:         null | 'proposed_by_me' | 'proposed_by_them' | 'confirmed',
  relationship_id:             uuid | null,
  first_encounter_at:          timestamptz | null,
  first_encounter_event_name:  text | null,
  last_encounter_at:           timestamptz | null,
  last_encounter_event_name:   text | null,
  encounter_count:             int,
  shared_intent:               text | null
}
```

`encounter_count` and shared event data are computed from `event_attendees` when no `relationships` row exists, so the profile page shows history even before a relationship is confirmed.

**Risk:** Low. All new functions. No existing function signatures change.

**Verify after applying:**
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('confirm_relationship','snooze_relationship','get_relationship_context');
```
Expected: 3 rows.

---

### 019 — `patch_intelligence_for_relationships`

**Purpose:** Patch `compute_interaction_intelligence()` and `get_my_intelligence()` via `CREATE OR REPLACE`.

**⚠ Highest-risk migration. Resolve Unknowns 2 and 3 before applying.**

#### `compute_interaction_intelligence()` — behavior changes

Two changes to the inner loop that iterates attendee pairs:

**Change A — Re-engagement update (replaces suppression):**

When a pair has an existing `confirmed` relationship row, the function previously would have skipped them (old design) or will now:
1. UPDATE `relationships SET last_encounter_at = now(), encounter_count = encounter_count + 1` for that pair.
2. INSERT an `interaction_intelligence` row with `type = 're_engaged'` (enabled by migration 016).

This preserves the co-attendance as a relationship health signal and gives the UI a "you're both here again" card to render.

**Change B — Historical shared-event bonus:**

For pairs with no existing relationship, before scoring, compute:
```sql
SELECT COUNT(DISTINCT ea1.event_id)
FROM event_attendees ea1
JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id AND ea2.profile_id = [target]
JOIN events e ON e.id = ea1.event_id
WHERE ea1.profile_id = [current]
  AND ea1.event_id != p_event_id
  AND e.starts_at < (SELECT starts_at FROM events WHERE id = p_event_id)
```

Add `MIN(count * 5.0, 20.0)` to the base score. Append `"You've both attended N previous events."` to the reason text when count > 0.

**No schema changes to `interaction_intelligence`** — only the CHECK constraint (from 016) enables the new `type` value.

#### `get_my_intelligence()` — behavior changes

Add a `relationship_status` field to each returned JSONB row by left-joining `relationships`:

| Value | Condition |
|---|---|
| `null` | No relationship row exists for this pair |
| `'proposed_by_me'` | Row exists, `proposed_by_id = current_profile_id()` |
| `'proposed_by_them'` | Row exists, `proposed_by_id ≠ current` and `status = 'proposed'` |
| `'confirmed'` | `status = 'confirmed'` |
| `'re_engaged'` | Intelligence row has `type = 're_engaged'` (confirmed pair, new co-attendance) |

This is a non-breaking additive change — the returned JSONB gains a new field. Existing callers that don't read `relationship_status` are unaffected.

**Verify after applying:**
```sql
-- Should return rows with a relationship_status field (even if null)
SELECT get_my_intelligence('[a known event uuid]'::uuid);
```

---

### 020 — `patch_public_attendees_relationship_status`

**Purpose:** Patch `get_public_event_attendees()` to include `relationship_status` for authenticated callers.

**Behavior change:**

The existing function returns `(profile_id, name, avatar_url, intent_primary, status)` where `status` is hardcoded `NULL::text`.

After patching:
- The `status` column is renamed to `connection_status` (or a new column is added alongside) containing the relationship status for the authenticated caller's relationship with each attendee.
- When called by an unauthenticated user (`current_profile_id()` returns null), the column returns `null` for all rows.

**Current consumer in `assets/js/join.js:904-911`:**
```js
const normalized = data
  .filter((r) => r.name)
  .map((r) => ({
    profileId: r.profile_id,
    name:      r.name,
    avatarUrl: r.avatar_url || null,
    intent:    r.intent_primary || null,
  }));
```

The consumer maps only `profile_id`, `name`, `avatar_url`, `intent_primary`. It does **not** read the current `status` column. Adding `relationship_status` to the response is safe — the consumer ignores unknown fields.

**Risk:** Low. Consumer is confirmed to ignore fields it does not map.

---

## 2. Existing Functions to Patch

| Function | File | Lines | Patch in migration |
|---|---|---|---|
| `compute_interaction_intelligence()` | `supabase/migrations/002_rls_and_functions.sql` | 116–208 | `019_patch_intelligence_for_relationships.sql` |
| `get_my_intelligence()` | `supabase/migrations/002_rls_and_functions.sql` | 214–274 | `019_patch_intelligence_for_relationships.sql` |
| `get_public_event_attendees()` | `supabase/migrations/014_get_public_event_attendees.sql` | 1–25 | `020_patch_public_attendees_relationship_status.sql` |

All patches use `CREATE OR REPLACE FUNCTION`. The original function bodies remain in the historical migration files as the rollback reference.

---

## 3. Web Touch Points

These files call patched RPCs. The changes are additive — no existing field is removed or renamed — so no code modifications are required at deployment time. UI changes to consume the new fields are a separate follow-on task.

### `assets/js/intelligence.js`

**RPC called:** `get_my_intelligence` at line 530.

**Current behavior:** Receives rows with `{ target_profile_id, target_name, target_avatar, score, reason, type, direction, created_at }`.

**After migration 019:** Rows additionally contain `relationship_status`. The rendering pipeline at lines 599–625 buckets rows by `d.type` into `recommended`, `follow_up`, `missed`. After migration 016+019, rows with `type = 're_engaged'` will not appear in any bucket and will be silently dropped from the UI (the `buckets` object has no `re_engaged` key).

**Action required before shipping UI work:** Add `re_engaged` to the `buckets` object with an appropriate section title (e.g., `"You connected again"`). This is a one-line addition. It is not required for the migration to be safe — unrecognised types are silently skipped.

### `assets/js/join.js`

**RPC called:** `get_public_event_attendees` at line 888.

**Current behavior:** Maps `profile_id`, `name`, `avatar_url`, `intent_primary` from response. The `status` column (currently always `null`) is not mapped.

**After migration 020:** Response includes `relationship_status`. The `.map()` at lines 904–911 does not read this field, so no change in behavior. The field is available for future UI work (e.g., showing "already connected" indicator on attendee cards).

**Action required before shipping UI work:** Add `relationshipStatus: r.relationship_status || null` to the normalized object.

---

## 4. Unknowns to Resolve

| # | Unknown | Why it matters | How to resolve |
|---|---|---|---|
| U1 | How migrations reach the live Supabase project | Determines whether §7 checklist is correct and whether any CI automation is needed | Ask the team; check Supabase project settings for linked CLI or deploy hooks |
| U2 | Where `compute_interaction_intelligence()` is invoked | Migration 019 changes its behavior; the caller must be tested | Search iOS codebase for the RPC name; check Supabase Studio for scheduled functions or webhooks |
| U3 | Whether iOS reads `get_my_intelligence()` | Migration 019 adds `relationship_status` to the response; strict iOS deserialization could break | Search iOS codebase for the RPC name; confirm iOS uses flexible JSON parsing |
| U4 | Whether any read replica or caching layer sits in front of these RPCs | Cache invalidation after the intelligence patch | Check Supabase project for PostgREST cache headers or CDN in front of the API |

---

## 5. RLS Risk Review

### New `relationships` table

**SELECT policy** (`profile_a_id = current_profile_id() OR profile_b_id = current_profile_id()`):  
Users can only see their own relationship rows. Third parties cannot enumerate relationships between other users. Correct.

**INSERT policy** (`proposed_by_id = current_profile_id()` AND profile membership):  
A user can only insert a row naming themselves as `proposed_by_id` and appearing as one of the pair. They cannot create a relationship row on behalf of other users. Correct.

**UPDATE policy** (either profile in the pair):  
Either party can update the row. This is intentional — snooze and second confirmation both require it. However, this also means either party could set `status = 'confirmed'` unilaterally without going through the RPC. **Mitigation:** The `confirm_relationship()` RPC is `SECURITY DEFINER` and enforces the two-party confirmation logic. For defense in depth, consider a row-level trigger that rejects direct `status` UPDATE to `confirmed` when `proposed_by_id = current_profile_id()` (i.e., prevents self-confirming). Not required in V1 but worth noting.

**No DELETE policy:**  
Rows cannot be deleted via the API. Correct — the relationship history is permanent.

**`compute_interaction_intelligence()` UPDATE of health columns:**  
This function runs as `SECURITY DEFINER` and updates `last_encounter_at` and `encounter_count` on confirmed pairs. It bypasses RLS. This is correct — health updates happen server-side and should not be user-controllable. Ensure no user-facing path can call this function with arbitrary event IDs (it currently has no RLS guard; callers should be restricted to admin/service role or the iOS app with a service key).

### Patched `get_my_intelligence()`

Returns rows for both directions (`profile_id = current` and `target_profile_id = current`). The existing RLS on `interaction_intelligence` already enforces this correctly and is unchanged. The new `relationship_status` join on `relationships` uses the same `current_profile_id()` — no new data exposure.

### Patched `get_public_event_attendees()`

This is a `SECURITY DEFINER` / `STABLE` function with no RLS applied to its output — it returns up to 200 attendees at any event to any caller (including unauthenticated). The new `relationship_status` column calls `current_profile_id()` internally, which returns `null` for unauthenticated callers. The function must handle the null case and return `null` for the column rather than erroring. **This must be verified in the migration SQL before deployment.**

---

## 6. Rollback Strategy

Rollbacks are independent per migration. Apply in reverse order if a multi-step rollback is needed.

| Migration | Rollback SQL | Data impact |
|---|---|---|
| **020** | `CREATE OR REPLACE FUNCTION get_public_event_attendees(...)` — restore previous body from `014_get_public_event_attendees.sql` | None — function-only change |
| **019** | `CREATE OR REPLACE FUNCTION compute_interaction_intelligence(...)` and `get_my_intelligence(...)` — restore previous bodies from `002_rls_and_functions.sql` | Any `re_engaged` rows written since 019 was applied will remain in `interaction_intelligence`. They will be orphaned (no bucket in the UI). Clean up: `DELETE FROM interaction_intelligence WHERE type = 're_engaged'`. Do this before rolling back 016. |
| **018** | `DROP FUNCTION confirm_relationship(uuid, uuid, uuid); DROP FUNCTION snooze_relationship(uuid, uuid); DROP FUNCTION get_relationship_context(uuid);` | None — function-only change |
| **017** | `DROP TABLE relationships CASCADE;` | **Destructive.** All relationship rows are lost. Only safe immediately after deployment before any users have confirmed relationships. If relationships exist, export first: `COPY relationships TO '/tmp/relationships_backup.csv' CSV HEADER;` |
| **016** | Restore original CHECK constraint: `ALTER TABLE interaction_intelligence DROP CONSTRAINT interaction_intelligence_type_check, ADD CONSTRAINT interaction_intelligence_type_check CHECK (type IN ('recommended', 'missed', 'follow_up'));` | Fails if any `re_engaged` rows exist. Delete them first (see 019 rollback note). |

**Safe rollback window:** Migrations 016, 017, 018 can be rolled back at any time with no data loss (no user-facing feature exists yet). Migration 019 creates the first opportunity for `re_engaged` rows to appear; once users attend events after 019 is deployed, rollback of 016+019 requires data cleanup. Migration 017 rollback is destructive once users begin confirming relationships.

---

## 7. Manual Supabase SQL Deployment Checklist

*(Applicable if migrations are applied via Supabase Studio SQL editor — see Unknown 1)*

### Pre-deployment

- [ ] Confirm the live Supabase project URL matches `unndeygygkgodmmdnlup.supabase.co`
- [ ] Resolve Unknown 2 (who calls `compute_interaction_intelligence()`) before proceeding to step 5
- [ ] Resolve Unknown 3 (iOS calls to `get_my_intelligence()`) before proceeding to step 5
- [ ] Take a point-in-time backup or note the current database state (Supabase Dashboard → Settings → Backups)
- [ ] Confirm no event is actively in-progress (i.e., attendees are not currently at an event where intelligence is being computed)

### Migration 016

- [ ] Open Supabase Studio → SQL Editor
- [ ] Paste and run the contents of `supabase/migrations/016_extend_intelligence_type.sql`
- [ ] Run verification query (see §1.1) — confirm `re_engaged` appears in check clause
- [ ] Record timestamp of application

### Migration 017

- [ ] Paste and run `supabase/migrations/017_relationships_table.sql`
- [ ] Run verification query (see §1.2) — confirm all columns present
- [ ] Confirm `SELECT COUNT(*) FROM relationships;` returns 0 (new table, empty)
- [ ] Record timestamp

### Migration 018

- [ ] Paste and run `supabase/migrations/018_relationship_rpcs.sql`
- [ ] Run verification query (see §1.3) — confirm 3 functions exist
- [ ] Smoke-test `get_relationship_context` with a known profile UUID:
  ```sql
  SELECT get_relationship_context('[any profile uuid]'::uuid);
  ```
  Expected: returns JSONB with `relationship_status = null` and `encounter_count >= 0`
- [ ] Record timestamp

### Migration 019

- [ ] **Resolve Unknowns 2 and 3 first**
- [ ] Paste and run `supabase/migrations/019_patch_intelligence_for_relationships.sql`
- [ ] Confirm `compute_interaction_intelligence` and `get_my_intelligence` still appear in `information_schema.routines`
- [ ] Smoke-test `get_my_intelligence` with a known event UUID:
  ```sql
  SELECT get_my_intelligence('[known event uuid]'::uuid);
  ```
  Expected: returns JSONB array; each row has a `relationship_status` key (value may be null)
- [ ] Record timestamp

### Migration 020

- [ ] Paste and run `supabase/migrations/020_patch_public_attendees_relationship_status.sql`
- [ ] Smoke-test with a known event UUID (unauthenticated context — use anon key):
  ```sql
  SELECT * FROM get_public_event_attendees('[known event uuid]'::uuid) LIMIT 5;
  ```
  Expected: rows return; `relationship_status` column present with null values (unauthenticated)
- [ ] Record timestamp

### Post-deployment

- [ ] Open the Nearify web app, navigate to an event's intelligence view, confirm cards render without error
- [ ] Open the join page for a known event, confirm attendee list loads without error
- [ ] Check Supabase Dashboard → Logs → API for any 5xx errors in the 15 minutes following deployment

---

## 8. Test Checklist

These tests validate the new behavior. They do not exist yet and must be written before or alongside implementation.

### Database / RPC tests (SQL or Supabase test runner)

- [ ] **016:** `INSERT INTO interaction_intelligence (..., type = 're_engaged')` succeeds after migration; fails before
- [ ] **017:** Two profiles with `profile_a_id > profile_b_id` cannot be inserted (canonical ordering enforced by RPC, not DB constraint — test that the RPC reorders correctly)
- [ ] **017:** Two rows for the same pair are rejected by the UNIQUE constraint
- [ ] **018 `confirm_relationship`:** First call inserts `status = 'proposed'`
- [ ] **018 `confirm_relationship`:** Second call from the other profile transitions to `status = 'confirmed'`
- [ ] **018 `confirm_relationship`:** Second call from the same profile is idempotent (returns existing row, no error)
- [ ] **018 `confirm_relationship`:** Call with `current = other` raises an error
- [ ] **018 `snooze_relationship`:** Sets correct snooze flag without changing status for the other party
- [ ] **018 `get_relationship_context`:** Returns correct `encounter_count` from `event_attendees` when no `relationships` row exists
- [ ] **018 `get_relationship_context`:** Returns `relationship_status = 'proposed_by_me'` when current profile is `proposed_by_id`
- [ ] **018 `get_relationship_context`:** Returns `relationship_status = 'proposed_by_them'` when other profile is `proposed_by_id`
- [ ] **019 `compute_interaction_intelligence`:** Confirmed pair at a new event updates `relationships.last_encounter_at` and increments `encounter_count`
- [ ] **019 `compute_interaction_intelligence`:** Confirmed pair produces a `re_engaged` row in `interaction_intelligence` (not skipped)
- [ ] **019 `compute_interaction_intelligence`:** Pair with shared prior events receives score bonus (score > same pair with no shared events and identical current-event signals)
- [ ] **019 `get_my_intelligence`:** Each returned row has a `relationship_status` key
- [ ] **019 `get_my_intelligence`:** Row for a confirmed pair returns `relationship_status = 'confirmed'`
- [ ] **020 `get_public_event_attendees`:** Returns `relationship_status = null` for all rows when called without auth
- [ ] **RLS:** Profile C cannot SELECT a `relationships` row between profiles A and B

### Web integration tests (manual, browser-based)

- [ ] **intelligence.js:** Intelligence cards render without error after migration 019 — no console errors, no blank sections
- [ ] **intelligence.js:** A `re_engaged` type row from the RPC does not cause a JS error (currently dropped silently — confirm no exception thrown)
- [ ] **join.js:** Attendee list loads without error after migration 020
- [ ] **join.js:** `relationship_status` field in the response does not break the `.map()` normalization
- [ ] **Profile page:** `get_relationship_context` returns data; page renders without error for a pair with no existing relationship
- [ ] **Profile page:** `get_relationship_context` returns data; page renders without error for a pair with an existing `proposed` relationship

---

## Summary

| Step | File | Status | Blocker |
|---|---|---|---|
| Resolve U1 (deployment path) | — | ⬜ Not started | Required before any live deployment |
| Resolve U2 (compute caller) | — | ⬜ Not started | Required before deploying migration 019 |
| Resolve U3 (iOS get_my_intelligence) | — | ⬜ Not started | Required before deploying migration 019 |
| Write migration 016 | `supabase/migrations/016_extend_intelligence_type.sql` | ⬜ Not started | None |
| Write migration 017 | `supabase/migrations/017_relationships_table.sql` | ⬜ Not started | None |
| Write migration 018 | `supabase/migrations/018_relationship_rpcs.sql` | ⬜ Not started | None |
| Write migration 019 | `supabase/migrations/019_patch_intelligence_for_relationships.sql` | ⬜ Not started | U2, U3 resolved |
| Write migration 020 | `supabase/migrations/020_patch_public_attendees_relationship_status.sql` | ⬜ Not started | None |
| Write tests | `tests/` | ⬜ Not started | Migrations written |
| Deploy to live DB | Supabase Studio | ⬜ Not started | U1 resolved, tests pass |
| Update `intelligence.js` UI | `assets/js/intelligence.js` | ⬜ Not started | Migrations deployed |
| Update `join.js` UI | `assets/js/join.js` | ⬜ Not started | Migrations deployed |
