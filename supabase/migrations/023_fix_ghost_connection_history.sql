-- 023_fix_ghost_connection_history.sql
-- Bug fix: get_ghost_connection_history was filtering interaction_type = 'qr_confirmed'
-- but record_ghost_connection writes interaction_type = 'ghost_connect'.
-- This caused the claim success screen to always show an empty names list.
--
-- Fix: include both 'ghost_connect' and 'qr_confirmed' rows from this ghost session.
-- API shape is unchanged (same columns, same function signature).

CREATE OR REPLACE FUNCTION public.get_ghost_connection_history(
  p_ghost_id  uuid,
  p_ghost_token text,
  p_event_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  interaction_id        uuid,
  event_id              uuid,
  to_profile_id         uuid,
  to_profile_name       text,
  connected_at          timestamptz,
  claimed_by_profile_id uuid,
  claimed_profile_id    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ghost record;
BEGIN
  SELECT gp.id, gp.claimed_by_profile_id
  INTO v_ghost
  FROM public.ghost_participants gp
  WHERE gp.id = p_ghost_id
    AND gp.ghost_token = p_ghost_token
    AND (p_event_id IS NULL OR gp.event_id = p_event_id)
  LIMIT 1;

  IF v_ghost.id IS NULL THEN
    RAISE EXCEPTION 'Ghost session not found';
  END IF;

  RETURN QUERY
  SELECT
    ie.id                           AS interaction_id,
    ie.event_id,
    ie.to_profile_id,
    COALESCE(p.name, 'Attendee')    AS to_profile_name,
    ie.created_at                   AS connected_at,
    ie.claimed_by_profile_id,
    v_ghost.claimed_by_profile_id   AS claimed_profile_id
  FROM public.interaction_events ie
  LEFT JOIN public.profiles p ON p.id = ie.to_profile_id
  WHERE ie.from_ghost_id = p_ghost_id
    AND (p_event_id IS NULL OR ie.event_id = p_event_id)
    -- Include ghost_connect (written by record_ghost_connection) and
    -- qr_confirmed (written by QR scan flow) — previously only qr_confirmed
    -- was included, which caused the claim success names list to be empty.
    AND ie.interaction_type IN ('ghost_connect', 'qr_confirmed')
  ORDER BY ie.created_at DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ghost_connection_history(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ghost_connection_history(uuid, text, uuid) TO anon, authenticated;
