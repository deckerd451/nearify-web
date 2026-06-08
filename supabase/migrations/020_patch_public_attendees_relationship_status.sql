-- ============================================================
-- Migration 020: Patch get_public_event_attendees to include
--                relationship_status for authenticated callers
-- ============================================================
-- Depends on: 017 (relationships table)
--
-- Adds a relationship_status column to the function's return type.
-- PostgreSQL does not allow changing a function's return type via
-- CREATE OR REPLACE, so this migration DROPs and recreates the
-- function. The function is SECURITY DEFINER with no dependent views,
-- so the DROP is safe.
--
-- Existing caller (assets/js/join.js:904–911) maps only
-- profile_id, name, avatar_url, and intent_primary — it does not
-- read the existing status column (always NULL) and will not read
-- relationship_status until the UI is updated. The change is safe.
--
-- Unauthenticated callers (anon role) receive relationship_status = null
-- for all rows. No new data is exposed to unauthenticated users.
-- ============================================================

-- Drop existing function (return type change requires DROP + CREATE)
DROP FUNCTION IF EXISTS public.get_public_event_attendees(uuid);

CREATE FUNCTION public.get_public_event_attendees(p_event_id uuid)
RETURNS TABLE (
  profile_id           uuid,
  name                 text,
  avatar_url           text,
  intent_primary       text,
  status               text,    -- retained for backward compatibility; always null
  relationship_status  text     -- null for unauthenticated; see values below
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
-- relationship_status values (authenticated callers):
--   null              — no relationship row exists for this pair
--   'proposed_by_me'  — current user proposed the relationship
--   'proposed_by_them'— other party proposed the relationship
--   'confirmed'       — mutual confirmation
DECLARE
  v_current_id uuid;
BEGIN
  v_current_id := current_profile_id();  -- NULL if unauthenticated

  RETURN QUERY
  SELECT
    ea.profile_id,
    p.name,
    p.avatar_url,
    ea.intent_primary,
    NULL::text AS status,
    CASE
      WHEN v_current_id IS NULL                        THEN NULL
      WHEN ea.profile_id = v_current_id                THEN NULL  -- own row
      WHEN rel.status IS NULL                          THEN NULL
      WHEN rel.status = 'confirmed'                    THEN 'confirmed'
      WHEN rel.proposed_by_id = v_current_id           THEN 'proposed_by_me'
      ELSE                                                  'proposed_by_them'
    END::text AS relationship_status
  FROM event_attendees ea
  JOIN profiles p ON p.id = ea.profile_id
  LEFT JOIN relationships rel
    ON rel.profile_a_id = LEAST(v_current_id, ea.profile_id)
   AND rel.profile_b_id = GREATEST(v_current_id, ea.profile_id)
   AND v_current_id IS NOT NULL         -- skip the join entirely when unauthenticated
   AND ea.profile_id != v_current_id    -- no self-join
  WHERE ea.event_id      = p_event_id
    AND ea.profile_id IS NOT NULL
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_event_attendees(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_event_attendees(uuid) TO anon, authenticated;


-- ============================================================
-- Verification
-- ============================================================
-- Run after applying.
--
-- 1. Confirm the function exists with the new return signature:
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_name   = 'get_public_event_attendees'  -- pg treats TABLE-returning
--   AND table_schema = 'public';                     -- functions as pseudo-tables
-- Alternative: \df+ get_public_event_attendees in psql
-- Expected: 6 columns including relationship_status.
--
-- 2. Smoke-test unauthenticated call (anon key context):
-- SELECT * FROM get_public_event_attendees('[known event uuid]'::uuid) LIMIT 3;
-- Expected: rows return; relationship_status = null for all rows.
--
-- 3. Smoke-test authenticated call (use a session with a known profile):
-- SELECT profile_id, relationship_status
-- FROM get_public_event_attendees('[known event uuid]'::uuid)
-- LIMIT 5;
-- Expected: rows where attendee is connected return 'confirmed';
--           own row returns null; unrelated attendees return null.
--
-- 4. Confirm join.js normalization is unbroken:
--    Open the join page for a known event in the browser.
--    Attendee list should load without console errors.
--    relationship_status is available in the response but not yet
--    mapped — this is expected and not an error.
-- ============================================================
