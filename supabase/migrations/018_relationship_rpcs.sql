-- ============================================================
-- Migration 018: Relationship RPCs
-- ============================================================
-- Three write RPCs and one read RPC for the relationships table.
--
--   confirm_relationship()       — first and second confirmation; idempotent
--   snooze_relationship()        — suppress the card until next co-attendance
--   get_relationship_context()   — read relationship state + encounter history
--
-- Identity rule: all IDs are profiles.id, never auth.users.id.
-- All RPCs resolve the caller via current_profile_id().
-- ============================================================

-- ============================================================
-- confirm_relationship
-- ============================================================
-- Called when a user taps "Confirm this relationship" on an
-- intelligence card. Handles both the first confirmation (INSERT,
-- status = proposed) and the second (UPDATE, status = confirmed).
--
-- Canonical ordering: profile_a_id = LEAST(current, other),
--                     profile_b_id = GREATEST(current, other).
-- Applied here at write time so all reads use the same ordering.
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_relationship(
  p_other_profile_id    uuid,
  p_source_event_id     uuid,
  p_source_intel_id     uuid  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_id        uuid;
  v_a_id              uuid;
  v_b_id              uuid;
  v_row               relationships%ROWTYPE;
  v_first_encounter   timestamptz;
BEGIN
  v_current_id := current_profile_id();
  IF v_current_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_current_id = p_other_profile_id THEN
    RAISE EXCEPTION 'Cannot confirm a relationship with yourself';
  END IF;

  -- Canonical pair ordering (lexicographic UUID sort)
  v_a_id := LEAST(v_current_id, p_other_profile_id);
  v_b_id := GREATEST(v_current_id, p_other_profile_id);

  -- Check for an existing row
  SELECT * INTO v_row
  FROM relationships
  WHERE profile_a_id = v_a_id
    AND profile_b_id = v_b_id;

  IF FOUND THEN
    -- Already confirmed — idempotent return
    IF v_row.status = 'confirmed' THEN
      RETURN jsonb_build_object(
        'relationship_id',   v_row.id,
        'status',            v_row.status,
        'first_encounter_at', v_row.first_encounter_at,
        'confirmed_at',      v_row.confirmed_at
      );
    END IF;

    -- Proposed by the other party — current user is second confirmer
    IF v_row.proposed_by_id IS DISTINCT FROM v_current_id THEN
      UPDATE relationships
      SET status       = 'confirmed',
          confirmed_at = now(),
          -- Clear any snooze the current user had set
          snoozed_by_a = CASE WHEN profile_a_id = v_current_id THEN false ELSE snoozed_by_a END,
          snoozed_by_b = CASE WHEN profile_b_id = v_current_id THEN false ELSE snoozed_by_b END
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'relationship_id',    v_row.id,
        'status',             v_row.status,
        'first_encounter_at', v_row.first_encounter_at,
        'confirmed_at',       v_row.confirmed_at
      );
    END IF;

    -- Proposed by the current user already — idempotent, clear any snooze
    UPDATE relationships
    SET snoozed_by_a = CASE WHEN profile_a_id = v_current_id THEN false ELSE snoozed_by_a END,
        snoozed_by_b = CASE WHEN profile_b_id = v_current_id THEN false ELSE snoozed_by_b END
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
      'relationship_id',    v_row.id,
      'status',             v_row.status,
      'first_encounter_at', v_row.first_encounter_at,
      'confirmed_at',       v_row.confirmed_at
    );
  END IF;

  -- No existing row — first confirmation. Compute first_encounter_at.
  -- Prefer the earliest interaction_events signal between the pair.
  SELECT MIN(ie.created_at)
  INTO v_first_encounter
  FROM interaction_events ie
  WHERE (ie.from_profile_id = v_current_id AND ie.to_profile_id = p_other_profile_id)
     OR (ie.from_profile_id = p_other_profile_id AND ie.to_profile_id = v_current_id);

  -- Fall back to earliest shared event attendance if no direct signal
  IF v_first_encounter IS NULL THEN
    SELECT MIN(e.starts_at)
    INTO v_first_encounter
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id;
  END IF;

  -- Last resort: use now()
  IF v_first_encounter IS NULL THEN
    v_first_encounter := now();
  END IF;

  INSERT INTO relationships (
    profile_a_id,
    profile_b_id,
    status,
    proposed_by_id,
    source_event_id,
    source_intelligence_id,
    first_encounter_at,
    encounter_count
  ) VALUES (
    v_a_id,
    v_b_id,
    'proposed',
    v_current_id,
    p_source_event_id,
    p_source_intel_id,
    v_first_encounter,
    1
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'relationship_id',    v_row.id,
    'status',             v_row.status,
    'first_encounter_at', v_row.first_encounter_at,
    'confirmed_at',       v_row.confirmed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_relationship(uuid, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_relationship(uuid, uuid, uuid) TO authenticated;


-- ============================================================
-- snooze_relationship
-- ============================================================
-- Dismisses the intelligence card for the current user without
-- signalling the other party. The card is suppressed until
-- compute_interaction_intelligence() clears the flag on the next
-- co-attendance.
--
-- If no relationship row exists yet, inserts one with status =
-- 'proposed' and proposed_by_id = NULL (no confirmation yet).
-- ============================================================
CREATE OR REPLACE FUNCTION public.snooze_relationship(
  p_other_profile_id  uuid,
  p_source_event_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_id       uuid;
  v_a_id             uuid;
  v_b_id             uuid;
  v_row              relationships%ROWTYPE;
  v_first_encounter  timestamptz;
BEGIN
  v_current_id := current_profile_id();
  IF v_current_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_current_id = p_other_profile_id THEN
    RAISE EXCEPTION 'Cannot snooze a relationship with yourself';
  END IF;

  v_a_id := LEAST(v_current_id, p_other_profile_id);
  v_b_id := GREATEST(v_current_id, p_other_profile_id);

  -- If a row already exists, set the caller's snooze flag
  UPDATE relationships
  SET snoozed_by_a = CASE WHEN profile_a_id = v_current_id THEN true ELSE snoozed_by_a END,
      snoozed_by_b = CASE WHEN profile_b_id = v_current_id THEN true ELSE snoozed_by_b END
  WHERE profile_a_id = v_a_id
    AND profile_b_id = v_b_id;

  IF FOUND THEN
    RETURN;
  END IF;

  -- No row yet — insert a proposed row with this party's snooze flag set
  SELECT MIN(ie.created_at)
  INTO v_first_encounter
  FROM interaction_events ie
  WHERE (ie.from_profile_id = v_current_id AND ie.to_profile_id = p_other_profile_id)
     OR (ie.from_profile_id = p_other_profile_id AND ie.to_profile_id = v_current_id);

  IF v_first_encounter IS NULL THEN
    SELECT MIN(e.starts_at)
    INTO v_first_encounter
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id;
  END IF;

  IF v_first_encounter IS NULL THEN
    v_first_encounter := now();
  END IF;

  INSERT INTO relationships (
    profile_a_id,
    profile_b_id,
    status,
    proposed_by_id,
    source_event_id,
    first_encounter_at,
    encounter_count,
    snoozed_by_a,
    snoozed_by_b
  ) VALUES (
    v_a_id,
    v_b_id,
    'proposed',
    NULL,                      -- no confirmation yet; just a snooze
    p_source_event_id,
    v_first_encounter,
    1,
    (v_a_id = v_current_id),   -- snooze the caller's slot
    (v_b_id = v_current_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.snooze_relationship(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.snooze_relationship(uuid, uuid) TO authenticated;


-- ============================================================
-- get_relationship_context
-- ============================================================
-- Returns the relationship state and encounter history between the
-- authenticated caller and one other profile. Called from the profile
-- page to drive connection status UI and the encounter timeline.
--
-- Safe to call unauthenticated: relationship_status and relationship_id
-- return null; encounter history is still populated from event_attendees.
-- ============================================================
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
BEGIN
  v_current_id := current_profile_id();  -- NULL if unauthenticated

  -- Compute encounter history from event_attendees regardless of auth state
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
  WHERE ea1.profile_id = COALESCE(v_current_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND ea2.profile_id = p_other_profile_id;

  -- Most frequent shared intent (use caller's intent across shared events)
  SELECT ea1.intent_primary
  INTO v_shared_intent
  FROM event_attendees ea1
  JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
  WHERE ea1.profile_id = COALESCE(v_current_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND ea2.profile_id = p_other_profile_id
    AND ea1.intent_primary IS NOT NULL
  GROUP BY ea1.intent_primary
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Event names for first and last encounter
  IF v_first_encounter_at IS NOT NULL THEN
    SELECT e.name INTO v_first_event_name
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = COALESCE(v_current_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ea2.profile_id = p_other_profile_id
      AND e.starts_at = v_first_encounter_at
    LIMIT 1;

    SELECT e.name INTO v_last_event_name
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = COALESCE(v_current_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ea2.profile_id = p_other_profile_id
      AND e.starts_at = v_last_encounter_at
    LIMIT 1;
  END IF;

  -- If unauthenticated, return encounter history only
  IF v_current_id IS NULL THEN
    RETURN jsonb_build_object(
      'relationship_status',        NULL,
      'relationship_id',            NULL,
      'first_encounter_at',         v_first_encounter_at,
      'first_encounter_event_name', v_first_event_name,
      'last_encounter_at',          v_last_encounter_at,
      'last_encounter_event_name',  v_last_event_name,
      'encounter_count',            v_encounter_count,
      'shared_intent',              v_shared_intent
    );
  END IF;

  v_a_id := LEAST(v_current_id, p_other_profile_id);
  v_b_id := GREATEST(v_current_id, p_other_profile_id);

  SELECT * INTO v_row
  FROM relationships
  WHERE profile_a_id = v_a_id
    AND profile_b_id = v_b_id;

  IF NOT FOUND THEN
    v_status := NULL;
  ELSIF v_row.status = 'confirmed' THEN
    -- Prefer stored health values when a confirmed relationship exists
    v_encounter_count    := GREATEST(v_row.encounter_count, v_encounter_count);
    v_last_encounter_at  := GREATEST(v_row.last_encounter_at, v_last_encounter_at);
    v_status             := 'confirmed';
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
-- Run after applying.
--
-- 1. Confirm all three RPCs exist:
-- SELECT routine_name
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'confirm_relationship',
--     'snooze_relationship',
--     'get_relationship_context'
--   );
-- Expected: 3 rows.
--
-- 2. Smoke-test get_relationship_context (safe read, no side effects):
-- SELECT get_relationship_context('[any valid profile uuid]'::uuid);
-- Expected: JSONB object with relationship_status, encounter_count,
--           and other fields. No error even if no shared history exists.
--
-- 3. Confirm anon access to get_relationship_context:
-- SET ROLE anon;
-- SELECT get_relationship_context('[any valid profile uuid]'::uuid);
-- RESET ROLE;
-- Expected: JSONB with relationship_status = null, encounter_count >= 0.
-- ============================================================
