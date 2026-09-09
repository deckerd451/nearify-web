-- ============================================================================
-- 026_admin_membership_and_event_creation.sql
--
-- NOT YET APPLIED / NOT DEPLOYED — for review only.
--
-- Purpose
--   Establish ONE canonical, database-backed source of truth for admin
--   membership, and make event creation an admin-only action enforced by the
--   database (not merely hidden in the UI). This replaces the earlier
--   PROPOSED_026 draft, which duplicated a hard-coded email allowlist in SQL.
--
-- Design
--   * Membership lives in public.admins, keyed by the STABLE authenticated
--     user id (auth.users.id) — not by email. Emails can change; ids do not.
--   * public.is_admin() is the single server-side predicate. The client asks
--     the server for the answer; it does NOT keep its own allowlist.
--   * Only INSERT on events is restricted. SELECT / UPDATE / DELETE policies
--     from 003_events_rls.sql are preserved.
--   * Ordinary users cannot read or modify the admin list (RLS + revoked
--     grants). is_admin() is SECURITY DEFINER so it can check membership
--     without exposing the table.
--
-- Adding / removing an admin later (NO app-code edits, NO new UI):
--   Run an intentional database statement (psql / Supabase SQL editor) as a
--   privileged role, identifying the user by STABLE identity (their auth id,
--   resolved from email at that moment):
--
--     -- add
--     INSERT INTO public.admins (user_id, note)
--     SELECT id, 'granted 2026-… by <who>'
--     FROM auth.users WHERE lower(email) = lower('new.admin@example.com')
--     ON CONFLICT (user_id) DO NOTHING;
--
--     -- remove
--     DELETE FROM public.admins
--     WHERE user_id = (SELECT id FROM auth.users
--                      WHERE lower(email) = lower('former.admin@example.com'));
--
--   (A future migration may also add/remove rows the same way.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Admin-membership table (smallest appropriate shape).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  note       text
);

-- ---------------------------------------------------------------------------
-- 2 & 6. Lock down the table. RLS on, and no policies for ordinary roles, so
--        anon/authenticated cannot read or modify the admin list at all.
--        (is_admin() below is SECURITY DEFINER and bypasses this to check
--        membership; privileged/service roles manage rows directly.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.admins FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Seed the two current administrators by locating their authenticated
--    accounts. FAIL SAFELY (raise) if an intended admin has no auth account,
--    rather than silently leaving them without access.
-- ---------------------------------------------------------------------------
DO $seed$
DECLARE
  seed_emails text[] := ARRAY['dmhamilton1@live.com', 'deckerdb26354@gmail.com'];
  e           text;
  uid         uuid;
BEGIN
  FOREACH e IN ARRAY seed_emails LOOP
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(e) LIMIT 1;
    IF uid IS NULL THEN
      RAISE EXCEPTION
        'Cannot seed admin: no authenticated account found for %. Ensure this user has signed in at least once, then re-run.', e;
    END IF;
    INSERT INTO public.admins (user_id, note)
    VALUES (uid, 'seeded 2026-09 initial administrator (' || e || ')')
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END
$seed$;

-- ---------------------------------------------------------------------------
-- 4 & 8. Server-side predicate. SECURITY DEFINER + explicit safe search_path.
--        Returns false for anon (auth.uid() is null → no match).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants: callable by clients; table access already revoked above.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Restrict event creation to admins. Ownership invariant preserved so an
--    admin still creates events owned by their own profile.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can create events" ON events;
DROP POLICY IF EXISTS "Admins can create events" ON events;

CREATE POLICY "Admins can create events"
  ON events FOR INSERT
  WITH CHECK (
    public.is_admin()
    AND created_by = current_profile_id()
  );

-- ---------------------------------------------------------------------------
-- 7. SELECT / UPDATE / DELETE policies from 003_events_rls.sql are intentionally
--    NOT modified here — existing browsing and owner event-management behavior
--    is preserved. No event rows are added, changed, or removed.
-- ---------------------------------------------------------------------------
