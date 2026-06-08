# Persistent Relationships — Deployment Notes

**Date:** 2026-06-08  
**Target:** `unndeygygkgodmmdnlup.supabase.co`  
**Deployment method:** Manual — Supabase Studio SQL Editor  
**Full plan:** `docs/PERSISTENT_RELATIONSHIPS_IMPLEMENTATION_PLAN.md`

---

## Before You Start

- [ ] Confirm the Supabase project URL: `unndeygygkgodmmdnlup.supabase.co`
- [ ] Note the current time — use it to scope the post-deployment log check
- [ ] Confirm no event is actively running (attendees should not be at a live event while 019 is deployed, since it replaces `compute_interaction_intelligence`)
- [ ] Open Supabase Dashboard → Settings → Backups and note the most recent backup timestamp

---

## Migration Order

Migrations must be applied in sequence. Each depends on the previous.

| Order | File | Depends on | Safe to rollback after? |
|---|---|---|---|
| 1 | `016_extend_intelligence_type.sql` | nothing | Yes — always |
| 2 | `017_relationships_table.sql` | 016 | Yes — until users confirm relationships |
| 3 | `018_relationship_rpcs.sql` | 017 | Yes — always |
| 4 | `019_patch_intelligence_for_relationships.sql` | 016, 017 | Yes — until next event compute runs |
| 5 | `020_patch_public_attendees_relationship_status.sql` | 017 | Yes — always |

---

## Step-by-Step Deployment

### Step 1 — Apply `016_extend_intelligence_type.sql`

Open Supabase Studio → SQL Editor → New query.  
Paste the full contents of `supabase/migrations/016_extend_intelligence_type.sql`.  
Run.

**Smoke test:**
```sql
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'interaction_intelligence_type_check';
```
Expected: one row, `check_clause` contains `'re_engaged'`.

---

### Step 2 — Apply `017_relationships_table.sql`

Paste and run `supabase/migrations/017_relationships_table.sql`.

**Smoke tests:**
```sql
-- Table exists with correct columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'relationships'
ORDER BY ordinal_position;
```
Expected: 15 rows.

```sql
-- Unique index exists
SELECT indexname FROM pg_indexes
WHERE tablename = 'relationships' AND indexname = 'idx_relationships_pair';
```
Expected: 1 row.

```sql
-- RLS is enabled, table is empty
SELECT relrowsecurity FROM pg_class WHERE relname = 'relationships';
SELECT COUNT(*) FROM relationships;
```
Expected: `t`, `0`.

---

### Step 3 — Apply `018_relationship_rpcs.sql`

Paste and run `supabase/migrations/018_relationship_rpcs.sql`.

**Smoke tests:**
```sql
-- All three RPCs exist
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'confirm_relationship',
    'snooze_relationship',
    'get_relationship_context'
  );
```
Expected: 3 rows.

```sql
-- get_relationship_context works (read-only, safe with any valid profile uuid)
SELECT get_relationship_context('[any valid profile uuid]'::uuid);
```
Expected: JSONB with `relationship_status`, `encounter_count`, and event name fields. No error.

---

### Step 4 — Apply `019_patch_intelligence_for_relationships.sql`

Paste and run `supabase/migrations/019_patch_intelligence_for_relationships.sql`.

**Smoke tests:**
```sql
-- Both functions still exist
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'compute_interaction_intelligence',
    'get_my_intelligence'
  );
```
Expected: 2 rows.

```sql
-- get_my_intelligence returns relationship_status field
-- (use a known event UUID with at least one attendee)
SELECT get_my_intelligence('[known event uuid]'::uuid);
```
Expected: JSONB array. Each element has a `relationship_status` key (value may be null). No error.

---

### Step 5 — Apply `020_patch_public_attendees_relationship_status.sql`

Paste and run `supabase/migrations/020_patch_public_attendees_relationship_status.sql`.

**Smoke tests:**
```sql
-- Function exists (with new return signature)
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_public_event_attendees';
```
Expected: 1 row.

```sql
-- Returns rows with relationship_status column
-- (use a known event UUID with attendees)
SELECT profile_id, name, relationship_status
FROM get_public_event_attendees('[known event uuid]'::uuid)
LIMIT 3;
```
Expected: rows return; `relationship_status` column present. Values are null for unauthenticated context.

---

## Post-Deployment Checks

Run these after all five migrations are applied.

```sql
-- Confirm no orphaned re_engaged rows (there should be none yet — none
-- have been written because compute hasn't run since deployment)
SELECT COUNT(*) FROM interaction_intelligence WHERE type = 're_engaged';
```
Expected: 0 (until the next event's intelligence is computed).

```sql
-- Confirm relationships table is still empty (no unexpected writes)
SELECT COUNT(*) FROM relationships;
```
Expected: 0.

**Browser checks:**
- Open any event's join page — attendee list must load without console errors.
- Open the web app's intelligence view for a recent event — cards must render without console errors.
- Check Supabase Dashboard → Logs → API for any 5xx errors in the 15 minutes following deployment.

---

## Rollback Reference

Apply rollback SQL in **reverse order** if anything goes wrong.

### Rollback 020
```sql
DROP FUNCTION IF EXISTS public.get_public_event_attendees(uuid);

CREATE FUNCTION public.get_public_event_attendees(p_event_id uuid)
RETURNS TABLE (
  profile_id     uuid,
  name           text,
  avatar_url     text,
  intent_primary text,
  status         text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    ea.profile_id,
    p.name,
    p.avatar_url,
    ea.intent_primary,
    NULL::text AS status
  FROM event_attendees ea
  JOIN profiles p ON p.id = ea.profile_id
  WHERE ea.event_id = p_event_id
    AND ea.profile_id IS NOT NULL
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.get_public_event_attendees(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_event_attendees(uuid) TO anon, authenticated;
```

### Rollback 019
Restore original bodies from `supabase/migrations/002_rls_and_functions.sql` lines 116–274.  
Copy those two `CREATE OR REPLACE FUNCTION` blocks and run them.

Then delete any `re_engaged` rows that were written before rollback:
```sql
DELETE FROM interaction_intelligence WHERE type = 're_engaged';
```

### Rollback 018
```sql
DROP FUNCTION IF EXISTS public.confirm_relationship(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.snooze_relationship(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_relationship_context(uuid);
```

### Rollback 017
**Destructive if any relationship rows exist.** Export first:
```sql
COPY relationships TO '/tmp/relationships_backup.csv' CSV HEADER;
```
Then:
```sql
DROP TABLE IF EXISTS public.relationships CASCADE;
```

### Rollback 016
Only safe after deleting all `re_engaged` intelligence rows (see rollback 019 above).
```sql
ALTER TABLE interaction_intelligence
  DROP CONSTRAINT interaction_intelligence_type_check,
  ADD CONSTRAINT interaction_intelligence_type_check
    CHECK (type IN ('recommended', 'missed', 'follow_up'));
```

---

## Known Limitations at This Deployment

These are not defects — they are deferred by design:

1. **`re_engaged` rows are not rendered in the UI.** `intelligence.js` buckets rows by type; `re_engaged` has no bucket yet and rows are silently skipped. No error is thrown. UI update is a follow-on task.

2. **`relationship_status` in join.js is not mapped.** The field is returned by `get_public_event_attendees` but not yet consumed in the attendee normalization. No error. UI update is a follow-on task.

3. **`get_relationship_context` is not yet called from any page.** The RPC is live and tested but the profile page does not call it yet. No user-visible change until wired up.

4. **`confirm_relationship` and `snooze_relationship` have no UI triggers.** The intelligence cards do not yet have a "Confirm" or "Snooze" button. No data flows into `relationships` until the UI is built.

In summary: all five migrations are safe to deploy. They are entirely additive from the user's perspective. No existing feature changes behavior. The `relationships` table will remain empty until the intelligence card UI is updated in the follow-on task.
