-- 024_get_relationship_context_ghost_claims.sql
-- Extends get_relationship_context() to surface ghost-claimed connections.
--
-- Problem: when a user claims a ghost session, claim_ghost_activity() stamps
-- interaction_events.claimed_by_profile_id but does NOT create a relationships row.
-- get_relationship_context() only read from relationships, so the profile page
-- showed no connection status and no encounter data for just-claimed connections.
--
-- Fix: after the relationships table lookup, if no row is found, check whether
-- the caller has claimed ghost interactions targeting the viewed profile. If so,
-- set relationship_status = 'ghost_claimed' and populate encounter data from
-- interaction_events instead of event_attendees.
--
-- Relationship row wins: the ghost check only runs when NOT FOUND in relationships.
-- No schema changes. No side effects (function remains STABLE read-only).

CREATE OR REPLACE FUNCTION public.get_relationship_context(
  p_other_profile_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_current_id           uuid;
  v_a_id                 uuid;
  v_b_id                 uuid;
  v_row                  relationships%ROWTYPE;
  v_status               text;
  v_encounter_count      int := 0;
  v_first_encounter_at   timestamptz;
  v_first_event_name     text;
  v_last_encounter_at    timestamptz;
  v_last_event_name      text;
  v_shared_intent        text;
  -- Ghost-claim fallback variables
  v_ghost_count          int := 0;
  v_ghost_first_at       timestamptz;
  v_ghost_last_at        timestamptz;
BEGIN
  v_current_id := current_profile_id();  -- NULL if unauthenticated

  IF v_current_id IS NULL THEN
    RETURN jsonb_build_object(
      'relationship_status',        NULL,
      'relationship_id',            NULL,
      'first_encounter_at',         NULL,
      'first_encounter_event_name', NULL,
      'last_encounter_at',          NULL,
      'last_encounter_event_name',  NULL,
      'encounter_count',            0,
      'shared_intent',              NULL
    );
  END IF;

  -- Compute encounter history from event_attendees (authenticated co-attendance)
  SELECT
    COUNT(DISTINCT ea1.event_id),
    MIN(e.starts_at),
    MAX(e.starts_at)
  INTO
    v_encounter_count,
    v_first_encounter_at,
    v_last_encounter_at
  FROM event_attendees ea1
  JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
  JOIN events e ON e.id = ea1.event_id
  WHERE ea1.profile_id = v_current_id
    AND ea2.profile_id = p_other_profile_id;

  -- Most frequent shared intent (caller's intent across shared events)
  SELECT ea1.intent_primary
  INTO v_shared_intent
  FROM event_attendees ea1
  JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
  WHERE ea1.profile_id = v_current_id
    AND ea2.profile_id = p_other_profile_id
    AND ea1.intent_primary IS NOT NULL
  GROUP BY ea1.intent_primary
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Event names for first and last encounter (event_attendees path)
  IF v_first_encounter_at IS NOT NULL THEN
    SELECT e.name INTO v_first_event_name
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id
      AND e.starts_at = v_first_encounter_at
    LIMIT 1;

    SELECT e.name INTO v_last_event_name
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id
      AND e.starts_at = v_last_encounter_at
    LIMIT 1;
  END IF;

  v_a_id := LEAST(v_current_id, p_other_profile_id);
  v_b_id := GREATEST(v_current_id, p_other_profile_id);

  SELECT * INTO v_row
  FROM relationships
  WHERE profile_a_id = v_a_id
    AND profile_b_id = v_b_id;

  IF NOT FOUND THEN
    -- No formal relationship row. Check for ghost-claimed interactions.
    -- This covers users who claimed a ghost session but haven't confirmed
    -- a relationship via confirm_relationship() yet.
    SELECT
      COUNT(DISTINCT ie.event_id),
      MIN(ie.created_at),
      MAX(ie.created_at)
    INTO
      v_ghost_count,
      v_ghost_first_at,
      v_ghost_last_at
    FROM interaction_events ie
    WHERE ie.claimed_by_profile_id = v_current_id
      AND ie.to_profile_id = p_other_profile_id
      AND ie.interaction_type IN ('ghost_connect', 'qr_confirmed');

    IF v_ghost_count > 0 THEN
      v_status := 'ghost_claimed';
      -- Supplement encounter data from interaction_events when event_attendees
      -- has no shared records (ghost users were not in event_attendees).
      IF v_encounter_count = 0 THEN
        v_encounter_count   := v_ghost_count;
        v_first_encounter_at := v_ghost_first_at;
        v_last_encounter_at  := v_ghost_last_at;

        SELECT e.name INTO v_first_event_name
        FROM interaction_events ie
        JOIN events e ON e.id = ie.event_id
        WHERE ie.claimed_by_profile_id = v_current_id
          AND ie.to_profile_id = p_other_profile_id
          AND ie.created_at = v_ghost_first_at
        LIMIT 1;

        IF v_ghost_last_at IS DISTINCT FROM v_ghost_first_at THEN
          SELECT e.name INTO v_last_event_name
          FROM interaction_events ie
          JOIN events e ON e.id = ie.event_id
          WHERE ie.claimed_by_profile_id = v_current_id
            AND ie.to_profile_id = p_other_profile_id
            AND ie.created_at = v_ghost_last_at
          LIMIT 1;
        END IF;
      END IF;
    ELSE
      v_status := NULL;
    END IF;

  ELSIF v_row.status = 'confirmed' THEN
    v_encounter_count    := GREATEST(v_row.encounter_count, v_encounter_count);
    v_last_encounter_at  := GREATEST(v_row.last_encounter_at, v_last_encounter_at);
    v_status             := 'confirmed';
  ELSIF v_row.proposed_by_id IS NULL THEN
    v_status := NULL;
  ELSIF v_row.proposed_by_id = v_current_id THEN
    v_status := 'proposed_by_me';
  ELSE
    v_status := 'proposed_by_them';
  END IF;

  RETURN jsonb_build_object(
    'relationship_status',        v_status,
    'relationship_id',            v_row.id,
    'first_encounter_at',         COALESCE(v_row.first_encounter_at, v_first_encounter_at),
    'first_encounter_event_name', v_first_event_name,
    'last_encounter_at',          COALESCE(v_row.last_encounter_at, v_last_encounter_at),
    'last_encounter_event_name',  v_last_event_name,
    'encounter_count',            v_encounter_count,
    'shared_intent',              v_shared_intent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_relationship_context(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_relationship_context(uuid) TO anon, authenticated;


-- ============================================================
-- Verification
-- ============================================================
-- After applying, smoke-test with a profile that was connected via ghost claim:
--
-- SELECT get_relationship_context('<other_profile_id>'::uuid);
-- Expected when ghost claim exists:
--   relationship_status = 'ghost_claimed'
--   encounter_count >= 1
--   first_encounter_event_name = <event name>
--
-- Expected when formal relationship row exists:
--   relationship_status = 'confirmed' | 'proposed_by_me' | 'proposed_by_them'
--   (ghost path is not reached)
--
-- Expected when neither exists:
--   relationship_status = null
--   encounter_count = 0
-- ============================================================
