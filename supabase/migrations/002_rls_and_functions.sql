-- ============================================================
-- RLS Policies + Server Functions
-- Identity rule: profiles.id is used for ALL relationships.
-- auth.users.id is used ONLY for auth session lookups.
-- ============================================================

-- Helper: resolve profile_id from current auth session
CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS uuid AS $$
  SELECT id FROM profiles WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---- RLS: interaction_events ----
ALTER TABLE interaction_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own interactions"
  ON interaction_events FOR SELECT
  USING (
    from_profile_id = current_profile_id()
    OR to_profile_id = current_profile_id()
  );

CREATE POLICY "iOS app inserts interactions"
  ON interaction_events FOR INSERT
  WITH CHECK (from_profile_id = current_profile_id());

-- ---- RLS: interaction_intelligence ----
ALTER TABLE interaction_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own intelligence"
  ON interaction_intelligence FOR SELECT
  USING (profile_id = current_profile_id());

-- ---- RPC: update_attendee_intent ----
-- Called from web after join to store intent
CREATE OR REPLACE FUNCTION update_attendee_intent(
  p_event_id        uuid,
  p_intent_primary  text,
  p_intent_secondary text[] DEFAULT '{}',
  p_energy_level    int     DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_profile_id uuid;
  v_result     jsonb;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for current user';
  END IF;

  UPDATE event_attendees
  SET
    intent_primary   = p_intent_primary,
    intent_secondary = p_intent_secondary,
    energy_level     = p_energy_level
  WHERE event_id   = p_event_id
    AND profile_id = v_profile_id
  RETURNING jsonb_build_object(
    'profile_id',       profile_id,
    'event_id',         event_id,
    'intent_primary',   intent_primary,
    'intent_secondary', intent_secondary,
    'energy_level',     energy_level
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Attendee record not found — join the event first';
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---- RPC: get_event_context ----
-- Consumed by iOS app to know user intent at an event
CREATE OR REPLACE FUNCTION get_event_context(p_event_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_profile_id uuid;
  v_result     jsonb;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for current user';
  END IF;

  SELECT jsonb_build_object(
    'event_id',         ea.event_id,
    'profile_id',       ea.profile_id,
    'intent_primary',   ea.intent_primary,
    'intent_secondary', ea.intent_secondary,
    'goals',            ea.goals,
    'constraints',      ea.constraints,
    'energy_level',     ea.energy_level,
    'joined_at',        ea.created_at
  )
  INTO v_result
  FROM event_attendees ea
  WHERE ea.event_id   = p_event_id
    AND ea.profile_id = v_profile_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Not attending this event';
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---- RPC: compute_interaction_intelligence ----
-- Phase 4 intelligence engine
CREATE OR REPLACE FUNCTION compute_interaction_intelligence(p_event_id uuid)
RETURNS int AS $$
DECLARE
  v_profile    record;
  v_target     record;
  v_score      float;
  v_reason     text;
  v_type       text;
  v_count      int := 0;
  v_dwell      int;
  v_confirmed  boolean;
  v_intent_match boolean;
BEGIN
  -- Clear previous intelligence for this event
  DELETE FROM interaction_intelligence WHERE event_id = p_event_id;

  -- For each attendee at the event
  FOR v_profile IN
    SELECT ea.profile_id, ea.intent_primary, ea.intent_secondary
    FROM event_attendees ea
    WHERE ea.event_id = p_event_id
  LOOP
    -- For each OTHER attendee
    FOR v_target IN
      SELECT ea.profile_id, ea.intent_primary, ea.intent_secondary
      FROM event_attendees ea
      WHERE ea.event_id = p_event_id
        AND ea.profile_id != v_profile.profile_id
    LOOP
      v_score := 0;
      v_reason := '';

      -- Aggregate interaction signals
      SELECT
        COALESCE(SUM(ie.dwell_seconds), 0),
        BOOL_OR(ie.interaction_type = 'qr_confirmed')
      INTO v_dwell, v_confirmed
      FROM interaction_events ie
      WHERE ie.event_id = p_event_id
        AND ie.from_profile_id = v_profile.profile_id
        AND ie.to_profile_id   = v_target.profile_id;

      -- Score: dwell time (max 40 pts)
      v_score := v_score + LEAST(v_dwell::float / 60.0 * 10.0, 40.0);

      -- Score: QR confirmation (30 pts)
      IF v_confirmed THEN
        v_score := v_score + 30.0;
        v_reason := v_reason || 'Confirmed connection. ';
      END IF;

      -- Score: intent alignment (30 pts)
      v_intent_match := (
        v_profile.intent_primary IS NOT NULL
        AND v_target.intent_primary IS NOT NULL
        AND (
          v_profile.intent_primary = v_target.intent_primary
          OR v_profile.intent_primary = ANY(v_target.intent_secondary)
          OR v_target.intent_primary = ANY(v_profile.intent_secondary)
        )
      );

      IF v_intent_match THEN
        v_score := v_score + 30.0;
        v_reason := v_reason || 'Shared intent: ' || v_target.intent_primary || '. ';
      END IF;

      -- Determine type
      IF v_score >= 50 THEN
        v_type := 'recommended';
        v_reason := v_reason || 'Strong match.';
      ELSIF v_dwell > 0 AND v_score < 30 THEN
        v_type := 'follow_up';
        v_reason := v_reason || 'Brief interaction — worth following up.';
      ELSIF v_intent_match AND v_dwell = 0 THEN
        v_type := 'missed';
        v_reason := v_reason || 'Aligned intent but no interaction recorded.';
      ELSE
        CONTINUE; -- skip low-signal pairs
      END IF;

      INSERT INTO interaction_intelligence
        (event_id, profile_id, target_profile_id, score, reason, type)
      VALUES
        (p_event_id, v_profile.profile_id, v_target.profile_id, v_score, v_reason, v_type);

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---- RPC: get_my_intelligence ----
-- Web UI calls this to show recommendations
CREATE OR REPLACE FUNCTION get_my_intelligence(p_event_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for current user';
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(r))
    FROM (
      SELECT
        ii.target_profile_id,
        p.name   AS target_name,
        p.avatar_url AS target_avatar,
        ii.score,
        ii.reason,
        ii.type,
        ii.created_at
      FROM interaction_intelligence ii
      JOIN profiles p ON p.id = ii.target_profile_id
      WHERE ii.event_id   = p_event_id
        AND ii.profile_id = v_profile_id
      ORDER BY ii.score DESC
    ) r
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
