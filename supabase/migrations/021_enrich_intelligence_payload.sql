-- ============================================================
-- Migration 021: Enrich get_my_intelligence payload
-- ============================================================
-- Depends on: 019 (relationship_status field, relationships JOIN)
--
-- Additive changes to get_my_intelligence():
--   my_intent              TEXT  — caller's primary intent at this event
--   their_intent           TEXT  — other party's primary intent at this event
--   dwell_seconds          INT   — total dwell time for this directional pair
--   encounter_count        INT   — how many events this pair has attended together
--                                  (0 when no relationship row exists yet)
--   first_encounter_event_name TEXT — name of the event where the relationship
--                                     was first surfaced (source_event_id on the
--                                     relationships row), NULL when no row yet
--
-- compute_interaction_intelligence() is unchanged.
-- All changes are strictly additive — existing callers not reading the new
-- fields are unaffected.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_intelligence(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_my_intent  text;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for current user';
  END IF;

  -- Resolve caller's intent at this event once, outside the per-row query.
  SELECT intent_primary INTO v_my_intent
  FROM event_attendees
  WHERE event_id = p_event_id AND profile_id = v_profile_id;

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
        v_my_intent                      AS my_intent,
        deduped.their_intent,
        deduped.dwell_seconds,
        COALESCE(rel.encounter_count, 0) AS encounter_count,
        e_first.name                     AS first_encounter_event_name,
        CASE
          WHEN deduped.type = 're_engaged'         THEN 're_engaged'
          WHEN rel.status IS NULL                  THEN NULL
          WHEN rel.status = 'confirmed'            THEN 'confirmed'
          WHEN rel.proposed_by_id = v_profile_id   THEN 'proposed_by_me'
          ELSE                                          'proposed_by_them'
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
          created_at,
          their_intent,
          dwell_seconds
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
            ii.created_at,
            ea_t.intent_primary   AS their_intent,
            (
              SELECT COALESCE(SUM(ie.dwell_seconds), 0)
              FROM interaction_events ie
              WHERE ie.event_id        = p_event_id
                AND ie.from_profile_id = v_profile_id
                AND ie.to_profile_id   = ii.target_profile_id
            )                     AS dwell_seconds
          FROM interaction_intelligence ii
          JOIN profiles p ON p.id = ii.target_profile_id
          LEFT JOIN event_attendees ea_t
            ON ea_t.event_id   = p_event_id
           AND ea_t.profile_id = ii.target_profile_id
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
            ii.created_at,
            ea_t.intent_primary   AS their_intent,
            (
              SELECT COALESCE(SUM(ie.dwell_seconds), 0)
              FROM interaction_events ie
              WHERE ie.event_id        = p_event_id
                AND ie.from_profile_id = ii.profile_id
                AND ie.to_profile_id   = v_profile_id
            )                     AS dwell_seconds
          FROM interaction_intelligence ii
          JOIN profiles p ON p.id = ii.profile_id
          LEFT JOIN event_attendees ea_t
            ON ea_t.event_id   = p_event_id
           AND ea_t.profile_id = ii.profile_id
          WHERE ii.event_id          = p_event_id
            AND ii.target_profile_id = v_profile_id
        ) combined
        ORDER BY other_id, score DESC
      ) deduped
      LEFT JOIN relationships rel
        ON rel.profile_a_id = LEAST(v_profile_id, deduped.target_profile_id)
       AND rel.profile_b_id = GREATEST(v_profile_id, deduped.target_profile_id)
      LEFT JOIN events e_first ON e_first.id = rel.source_event_id
      ORDER BY deduped.score DESC
    ) final
  );
END;
$$;


-- ============================================================
-- Verification
-- ============================================================
-- Run after applying. Depends on 019 already being applied.
--
-- 1. Confirm the function still exists:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'get_my_intelligence';
-- Expected: 1 row.
--
-- 2. Smoke-test with a known event UUID:
-- SELECT get_my_intelligence('[event uuid]'::uuid);
-- Expected: JSONB array. Each row object should now include:
--   my_intent, their_intent, dwell_seconds, encounter_count,
--   first_encounter_event_name, relationship_status.
-- ============================================================
