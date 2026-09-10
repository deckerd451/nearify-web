-- Migration 031: Co-attendee gating for get_public_event_attendees (Option B).
-- ============================================================
-- Depends on: 030 (avatar_url withheld from unauthenticated callers)
--
-- POLICY: An authenticated user may only see an event's attendee list if they
-- are themselves an attendee of that event. This matches the iOS app, which
-- only ever fetches attendees for the event the user has actively joined
-- (EventAttendeesService.fetchAttendees scopes to the active event + own
-- profile), and closes the enumeration hole where any signed-in user could
-- browse the attendee list (name + photo + intent) of ANY event.
--
-- Behavior by caller type:
--   • Authenticated AND attending p_event_id  → full rows (photos + relationship_status)
--   • Authenticated but NOT attending          → no rows
--   • Unauthenticated / guest join flow         → rows WITHOUT photos (avatar_url NULL,
--                                                  per migration 030). Guests reach this
--                                                  only from a specific event's join page;
--                                                  there is no server-side guest identity
--                                                  to gate on, and withholding the room
--                                                  entirely would break the guest experience.
--
-- Return type unchanged from migration 030, so CREATE OR REPLACE is used.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_public_event_attendees(p_event_id uuid)
RETURNS TABLE (
  profile_id           uuid,
  name                 text,
  avatar_url           text,
  intent_primary       text,
  status               text,
  relationship_status  text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_current_id     uuid;
  v_is_attending   boolean;
BEGIN
  v_current_id := current_profile_id();  -- NULL if unauthenticated

  -- Co-attendee gate: an authenticated caller who is NOT an attendee of this
  -- event receives no rows. Unauthenticated callers are not gated here (they
  -- are already limited to photo-less rows by the CASE below and only reach
  -- this function from a specific event's guest join flow).
  IF v_current_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM event_attendees
      WHERE event_id = p_event_id
        AND profile_id = v_current_id
    ) INTO v_is_attending;

    IF NOT v_is_attending THEN
      RETURN;  -- no rows
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    ea.profile_id,
    p.name,
    CASE WHEN v_current_id IS NULL THEN NULL ELSE p.avatar_url END::text AS avatar_url,
    ea.intent_primary,
    NULL::text AS status,
    CASE
      WHEN v_current_id IS NULL                        THEN NULL
      WHEN ea.profile_id = v_current_id                THEN NULL
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
-- 1. Authenticated user attending the event → sees rows (with photos).
-- 2. Authenticated user NOT attending the event → zero rows.
-- 3. Unauthenticated (anon) → rows with avatar_url = NULL (guest room view).
-- ============================================================
