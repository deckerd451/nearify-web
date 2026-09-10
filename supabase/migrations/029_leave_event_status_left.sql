-- Migration 029: Redefine leave_event to set status = 'left' instead of
--                deleting the event_attendees row.
-- ============================================================
-- Supersedes migration 028 (which hard-deleted the row).
--
-- WHY: The iOS app leaves an event by writing status = 'left' to
-- event_attendees (see EventPresenceService.setAttendanceStatus / leaveCurrentEvent).
-- It never deletes the row. Deleting from the web created two problems:
--   1. Cross-app inconsistency — iOS "left" rows persisted, web "left" rows vanished.
--   2. Loss of co-attendance history — encounter_count and relationship history
--      are computed from event_attendees; deleting erases that the user attended.
--
-- This version updates status = 'left' (and refreshes last_seen_at) so leaving
-- behaves identically whether initiated from web or iOS, and history is preserved.
-- Scoped strictly to current_profile_id() so a user can only affect their own row.
-- Idempotent: returns removed=false when no matching row exists.
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_updated    int;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE event_attendees
  SET status       = 'left',
      last_seen_at = now()
  WHERE event_id   = p_event_id
    AND profile_id = v_profile_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'removed',  v_updated > 0,
    'status',   'left'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_event(uuid) TO authenticated;

-- Verification (manual):
--   SELECT public.leave_event('[event uuid]'::uuid);
--   -- then confirm the row shows status = 'left', not deleted:
--   SELECT status FROM event_attendees
--     WHERE event_id = '[event uuid]' AND profile_id = current_profile_id();
