-- ============================================================
-- Migration 019: Patch compute_interaction_intelligence and
--                get_my_intelligence for persistent relationships
-- ============================================================
-- Depends on: 016 (re_engaged type), 017 (relationships table)
--
-- compute_interaction_intelligence() changes:
--   1. Confirmed pairs: update relationship health columns
--      (last_encounter_at, encounter_count) and write a 're_engaged'
--      intelligence row instead of skipping them.
--      Health columns are updated only once per pair per run
--      (guarded by canonical direction: profile_a_id = v_profile).
--   2. Unconfirmed pairs: add historical shared-event bonus
--      (up to +20 pts) before scoring. Clears snooze flags on new
--      co-attendance for proposed rows.
--
-- get_my_intelligence() changes:
--   1. Adds relationship_status field to each returned JSONB row.
--      Additive change — existing callers that do not read the field
--      are unaffected.
-- ============================================================


-- ============================================================
-- compute_interaction_intelligence (patched)
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_interaction_intelligence(p_event_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile                 record;
  v_target                  record;
  v_score                   float;
  v_reason                  text;
  v_type                    text;
  v_count                   int     := 0;
  v_dwell                   int;
  v_confirmed_qr            boolean;
  v_intent_match            boolean;
  v_shared_events           int;
  v_is_confirmed            boolean;
  v_event_already_processed boolean;
BEGIN
  -- Capture whether re_engaged rows already exist BEFORE the DELETE so
  -- encounter_count is not double-incremented on re-runs for the same event.
  SELECT EXISTS (
    SELECT 1 FROM interaction_intelligence
    WHERE event_id = p_event_id AND type = 're_engaged'
  ) INTO v_event_already_processed;

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
      v_score  := 0;
      v_reason := '';

      -- --------------------------------------------------------
      -- Check for an existing confirmed relationship between
      -- this pair (canonical ordering: a < b lexicographically).
      -- --------------------------------------------------------
      SELECT EXISTS (
        SELECT 1 FROM relationships
        WHERE profile_a_id = LEAST(v_profile.profile_id, v_target.profile_id)
          AND profile_b_id = GREATEST(v_profile.profile_id, v_target.profile_id)
          AND status = 'confirmed'
      ) INTO v_is_confirmed;

      IF v_is_confirmed THEN
        -- Update health columns exactly once per pair per run.
        -- Guard 1: only the canonical (a→b) direction to avoid double-increment
        --          within a single run.
        -- Guard 2: skip if re_engaged rows already existed before this run
        --          (v_event_already_processed = true) to keep the function
        --          idempotent when called more than once for the same event.
        IF NOT v_event_already_processed
           AND v_profile.profile_id = LEAST(v_profile.profile_id, v_target.profile_id) THEN
          UPDATE relationships
          SET last_encounter_at = now(),
              encounter_count   = encounter_count + 1
          WHERE profile_a_id = v_profile.profile_id
            AND profile_b_id = v_target.profile_id
            AND status = 'confirmed';
        END IF;

        -- Write a re_engaged record for this direction.
        -- Both (a→b) and (b→a) rows are needed so get_my_intelligence
        -- surfaces the card for both parties.
        INSERT INTO interaction_intelligence
          (event_id, profile_id, target_profile_id, score, reason, type)
        VALUES (
          p_event_id,
          v_profile.profile_id,
          v_target.profile_id,
          100.0,
          'You have a confirmed relationship — you are both here again.',
          're_engaged'
        );

        v_count := v_count + 1;
        CONTINUE;
      END IF;

      -- --------------------------------------------------------
      -- Standard scoring for pairs with no confirmed relationship
      -- --------------------------------------------------------

      -- Aggregate interaction signals for this direction
      SELECT
        COALESCE(SUM(ie.dwell_seconds), 0),
        BOOL_OR(ie.interaction_type = 'qr_confirmed')
      INTO v_dwell, v_confirmed_qr
      FROM interaction_events ie
      WHERE ie.event_id        = p_event_id
        AND ie.from_profile_id = v_profile.profile_id
        AND ie.to_profile_id   = v_target.profile_id;

      -- Score: dwell time (max 40 pts)
      v_score := v_score + LEAST(v_dwell::float / 60.0 * 10.0, 40.0);

      -- Score: QR confirmation (30 pts)
      IF v_confirmed_qr THEN
        v_score  := v_score + 30.0;
        v_reason := v_reason || 'Confirmed connection. ';
      END IF;

      -- Score: intent alignment (30 pts)
      v_intent_match := (
        v_profile.intent_primary IS NOT NULL
        AND v_target.intent_primary IS NOT NULL
        AND (
          v_profile.intent_primary = v_target.intent_primary
          OR v_profile.intent_primary = ANY(v_target.intent_secondary)
          OR v_target.intent_primary  = ANY(v_profile.intent_secondary)
        )
      );

      IF v_intent_match THEN
        v_score  := v_score + 30.0;
        v_reason := v_reason || 'Shared intent: ' || v_target.intent_primary || '. ';
      END IF;

      -- Score: historical shared-event bonus (max +20 pts)
      -- Counts events the pair both attended before this one.
      SELECT COUNT(DISTINCT ea1.event_id)
      INTO v_shared_events
      FROM event_attendees ea1
      JOIN event_attendees ea2
        ON ea1.event_id    = ea2.event_id
       AND ea2.profile_id  = v_target.profile_id
      JOIN events e ON e.id = ea1.event_id
      WHERE ea1.profile_id = v_profile.profile_id
        AND ea1.event_id  != p_event_id
        AND e.starts_at    < (SELECT starts_at FROM events WHERE id = p_event_id);

      IF v_shared_events > 0 THEN
        v_score  := v_score + LEAST(v_shared_events * 5.0, 20.0);
        v_reason := v_reason
          || 'You''ve both attended '
          || v_shared_events
          || ' previous event'
          || CASE WHEN v_shared_events > 1 THEN 's' ELSE '' END
          || '. ';
      END IF;

      -- Clear snooze flag for this pair on new co-attendance signal
      -- (only for the canonical direction to avoid double-update)
      IF v_profile.profile_id = LEAST(v_profile.profile_id, v_target.profile_id) THEN
        UPDATE relationships
        SET snoozed_by_a = false,
            snoozed_by_b = false
        WHERE profile_a_id = v_profile.profile_id
          AND profile_b_id = v_target.profile_id
          AND status       = 'proposed'
          AND (snoozed_by_a OR snoozed_by_b);
      END IF;

      -- Determine intelligence type
      IF v_score >= 50 THEN
        v_type   := 'recommended';
        v_reason := v_reason || 'Strong match.';
      ELSIF v_dwell > 0 AND v_score < 30 THEN
        v_type   := 'follow_up';
        v_reason := v_reason || 'Brief interaction — notable signal.';
      ELSIF v_intent_match AND v_dwell = 0 THEN
        v_type   := 'missed';
        v_reason := v_reason || 'Aligned intent but no interaction recorded.';
      ELSE
        CONTINUE; -- skip low-signal pairs
      END IF;

      INSERT INTO interaction_intelligence
        (event_id, profile_id, target_profile_id, score, reason, type)
      VALUES (
        p_event_id,
        v_profile.profile_id,
        v_target.profile_id,
        v_score,
        v_reason,
        v_type
      );

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;


-- ============================================================
-- get_my_intelligence (patched)
-- ============================================================
-- Additive change: adds relationship_status to each returned row.
-- Values:
--   null             — no relationship row exists for this pair
--   'proposed_by_me' — row exists, current user proposed it
--   'proposed_by_them' — row exists, other party proposed it
--   'confirmed'      — mutual confirmation
--   're_engaged'     — intelligence type is re_engaged (confirmed pair,
--                      new co-attendance — surfaced separately from status)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_intelligence(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for current user';
  END IF;

  RETURN (
    SELECT jsonb_agg(row_to_json(final))
    FROM (
      SELECT
        deduped.target_profile_id,
        deduped.target_name,
        deduped.target_avatar,
        deduped.score,
        deduped.reason,
        deduped.type,
        deduped.direction,
        deduped.created_at,
        CASE
          WHEN deduped.type = 're_engaged'                     THEN 're_engaged'
          WHEN rel.status IS NULL                              THEN NULL
          WHEN rel.status = 'confirmed'                        THEN 'confirmed'
          WHEN rel.proposed_by_id = v_profile_id              THEN 'proposed_by_me'
          ELSE                                                      'proposed_by_them'
        END AS relationship_status
      FROM (
        SELECT DISTINCT ON (other_id)
          other_id       AS target_profile_id,
          other_name     AS target_name,
          other_avatar   AS target_avatar,
          score,
          reason,
          type,
          direction,
          created_at
        FROM (
          -- Rows where current user is the source (You → them)
          SELECT
            ii.target_profile_id  AS other_id,
            p.name                AS other_name,
            p.avatar_url          AS other_avatar,
            ii.score,
            ii.reason,
            ii.type,
            'outgoing'::text      AS direction,
            ii.created_at
          FROM interaction_intelligence ii
          JOIN profiles p ON p.id = ii.target_profile_id
          WHERE ii.event_id   = p_event_id
            AND ii.profile_id = v_profile_id

          UNION ALL

          -- Rows where current user is the target (Them → you)
          SELECT
            ii.profile_id         AS other_id,
            p.name                AS other_name,
            p.avatar_url          AS other_avatar,
            ii.score,
            ii.reason,
            ii.type,
            'incoming'::text      AS direction,
            ii.created_at
          FROM interaction_intelligence ii
          JOIN profiles p ON p.id = ii.profile_id
          WHERE ii.event_id          = p_event_id
            AND ii.target_profile_id = v_profile_id
        ) combined
        ORDER BY other_id, score DESC
      ) deduped
      LEFT JOIN relationships rel
        ON rel.profile_a_id = LEAST(v_profile_id, deduped.target_profile_id)
       AND rel.profile_b_id = GREATEST(v_profile_id, deduped.target_profile_id)
      ORDER BY deduped.score DESC
    ) final
  );
END;
$$;


-- ============================================================
-- Verification
-- ============================================================
-- Run after applying. Depends on 016 and 017 already being applied.
--
-- 1. Confirm both functions still exist with correct signatures:
-- SELECT routine_name, data_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN (
--     'compute_interaction_intelligence',
--     'get_my_intelligence'
--   );
-- Expected: 2 rows.
--
-- 2. Smoke-test get_my_intelligence with a known event UUID:
-- SELECT get_my_intelligence('[known event uuid]'::uuid);
-- Expected: JSONB array (possibly null if no attendees).
--           Each row object has a 'relationship_status' key.
--
-- 3. Verify re_engaged rows flow through get_my_intelligence:
--   a. Manually INSERT a confirmed relationship row for a test pair.
--   b. Run compute_interaction_intelligence('[event where pair attended]').
--   c. Run get_my_intelligence('[that event]') as one of the pair.
--   d. Confirm: returned rows include one with type='re_engaged'
--      and relationship_status='re_engaged'.
--   e. Clean up test data.
--
-- 4. Verify encounter_count increments:
--    SELECT encounter_count FROM relationships WHERE id = '[test row id]';
--    Expected: incremented by 1 after step (b) above.
-- ============================================================
