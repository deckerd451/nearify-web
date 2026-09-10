-- Migration 028: leave_event RPC — let an authenticated user revoke their
--                own attendance for an event.
-- ============================================================
-- Deletes the caller's own row from event_attendees for the given event.
-- Scoped strictly to current_profile_id() so a user can only remove their
-- own attendance. Idempotent: returns removed=false when no row existed.
--
-- Mirrors the SECURITY DEFINER + current_profile_id() pattern used by
-- update_attendee_intent (002) and the relationship RPCs (018).
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_deleted    int;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM event_attendees
  WHERE event_id   = p_event_id
    AND profile_id = v_profile_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'removed',  v_deleted > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_event(uuid) TO authenticated;

-- Verification (manual):
--   SELECT public.leave_event('[event uuid]'::uuid);
