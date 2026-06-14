-- 022_get_my_connections.sql
-- Read-only RPC that returns all connections for the calling user.
-- Used by the /connections/ page.
--
-- No schema changes. Reads: relationships, interaction_events, profiles, events.
--
-- Data model reality:
--   record_ghost_connection  → writes interaction_events (from_ghost_id, to_profile_id, type='ghost_connect')
--   claim_ghost_activity     → stamps interaction_events.claimed_by_profile_id = profile_id
--   relationships table      → NOT written by either RPC above; only written via confirm_relationship()
--
-- Therefore this function must include TWO sources and deduplicate them:
--   Source A: relationships rows (confirmed or proposed via confirm_relationship)
--   Source B: claimed ghost interaction_events that have no corresponding relationship row
--
-- Deduplication: if a relationships row exists for a pair, Source A wins.
-- Ghost connections are included whenever p_status = 'confirmed' or 'all',
-- because a voluntary ghost-connect is equivalent intent to a confirmed connection.

CREATE OR REPLACE FUNCTION get_my_connections(
  p_status text DEFAULT 'confirmed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  SELECT id INTO v_caller_id
  FROM profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE(
    (
      WITH

      -- Source A: formal relationship rows (from confirm_relationship RPC)
      rel_rows AS (
        SELECT
          r.id                                               AS relationship_id,
          r.status,
          CASE
            WHEN r.status = 'confirmed'         THEN 'confirmed'
            WHEN r.proposed_by_id = v_caller_id THEN 'proposed_by_me'
            WHEN r.proposed_by_id IS NOT NULL   THEN 'proposed_by_them'
            ELSE 'proposed'
          END                                               AS relationship_label,
          CASE
            WHEN r.profile_a_id = v_caller_id THEN r.profile_b_id
            ELSE r.profile_a_id
          END                                               AS other_profile_id,
          r.encounter_count,
          r.first_encounter_at,
          r.last_encounter_at,
          r.confirmed_at,
          r.source_event_id,
          r.created_at
        FROM relationships r
        WHERE (r.profile_a_id = v_caller_id OR r.profile_b_id = v_caller_id)
          AND (p_status = 'all' OR r.status = p_status)
      ),

      -- Source B: ghost interactions that were claimed by this user,
      -- grouped per target profile (one row per person connected with).
      -- Includes only profiles NOT already covered by a relationships row.
      ghost_rows AS (
        SELECT
          NULL::uuid                                        AS relationship_id,
          'ghost_claimed'                                   AS status,
          'ghost_claimed'                                   AS relationship_label,
          ie.to_profile_id                                  AS other_profile_id,
          COUNT(*)::int                                     AS encounter_count,
          MIN(ie.created_at)                                AS first_encounter_at,
          MAX(ie.created_at)                                AS last_encounter_at,
          NULL::timestamptz                                 AS confirmed_at,
          ie.event_id                                       AS source_event_id,
          MIN(ie.created_at)                                AS created_at
        FROM interaction_events ie
        WHERE ie.claimed_by_profile_id = v_caller_id
          AND ie.from_ghost_id IS NOT NULL
          AND ie.to_profile_id IS NOT NULL
          -- Exclude pairs already covered by a relationship row
          AND ie.to_profile_id NOT IN (SELECT other_profile_id FROM rel_rows)
          -- Include ghost_claimed only when caller wants confirmed or all connections
          AND p_status IN ('confirmed', 'all')
        GROUP BY ie.to_profile_id, ie.event_id
      ),

      -- Union both sources, annotate with profile and event details
      all_rows AS (
        SELECT * FROM rel_rows
        UNION ALL
        SELECT * FROM ghost_rows
      )

      SELECT jsonb_agg(row_to_json(t) ORDER BY t.last_encounter_at DESC NULLS LAST, t.created_at DESC)
      FROM (
        SELECT
          ar.relationship_id,
          ar.status,
          ar.relationship_label,
          p.id                                              AS profile_id,
          p.name,
          p.avatar_url,
          ar.encounter_count,
          ar.first_encounter_at,
          ar.last_encounter_at,
          ar.confirmed_at,
          e.name                                            AS first_encounter_event_name,
          ar.source_event_id,
          ar.created_at
        FROM all_rows ar
        JOIN profiles p ON p.id = ar.other_profile_id
        LEFT JOIN events e ON e.id = ar.source_event_id
      ) t
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_connections(text) TO authenticated;
