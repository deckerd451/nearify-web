-- Migration 030: Withhold attendee photos from unauthenticated callers.
-- ============================================================
-- Depends on: 020 (get_public_event_attendees with relationship_status)
--
-- get_public_event_attendees is a SECURITY DEFINER RPC granted to `anon`
-- and `authenticated`. It previously returned p.avatar_url to ALL callers,
-- so an anonymous visitor received attendee photo URLs in the payload even
-- though the web UI (join.js) renders initials only.
--
-- This migration recreates the function so that avatar_url is returned as
-- NULL when the caller is unauthenticated (current_profile_id() IS NULL).
-- Authenticated callers are unaffected. No other columns change.
--
-- Return type is identical to migration 020, so CREATE OR REPLACE is used
-- (no DROP needed — the column set/types match exactly).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_public_event_attendees(p_event_id uuid)
RETURNS TABLE (
  profile_id           uuid,
  name                 text,
  avatar_url           text,
  intent_primary       text,
  status               text,    -- retained for backward compatibility; always null
  relationship_status  text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_current_id uuid;
BEGIN
  v_current_id := current_profile_id();  -- NULL if unauthenticated

  RETURN QUERY
  SELECT
    ea.profile_id,
    p.name,
    -- Photos are only exposed to authenticated callers. Anonymous visitors
    -- receive NULL so no attendee photo URLs leave the server.
    CASE WHEN v_current_id IS NULL THEN NULL ELSE p.avatar_url END::text AS avatar_url,
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
   AND v_current_id IS NOT NULL
   AND ea.profile_id != v_current_id
  WHERE ea.event_id      = p_event_id
    AND ea.profile_id IS NOT NULL
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_event_attendees(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_event_attendees(uuid) TO anon, authenticated;

-- ============================================================
-- Verification (manual)
-- ============================================================
-- 1. Unauthenticated (anon key): avatar_url must be NULL for all rows.
--    SELECT profile_id, avatar_url FROM get_public_event_attendees('[event uuid]'::uuid);
--    Expected: avatar_url = NULL for every row.
--
-- 2. Authenticated (session with a profile): avatar_url returns the real value.
--    SELECT profile_id, avatar_url FROM get_public_event_attendees('[event uuid]'::uuid);
--    Expected: avatar_url populated where the profile has one.
-- ============================================================
