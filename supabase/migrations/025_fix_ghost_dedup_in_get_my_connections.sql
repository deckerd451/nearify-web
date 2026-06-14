-- 025_fix_ghost_dedup_in_get_my_connections.sql
-- Bug fix: get_my_connections() could return the same person multiple times
-- when a ghost user connected with them across more than one event, because
-- ghost_rows CTE used GROUP BY (to_profile_id, event_id).
--
-- Fix: group ghost rows by to_profile_id only, producing exactly one row per
-- person. source_event_id is set to the event from the earliest interaction
-- (the "how we met" event). encounter_count now reflects cross-event presence.
--
-- No schema changes. CREATE OR REPLACE is safe to re-run.

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

      -- Source A: formal relationship rows (from confirm_relationship RPC).
      -- One row per person by definition (unique index on profile_a/b pair).
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

      -- Source B: ghost interactions claimed by this user.
      -- Grouped by to_profile_id ONLY (not event_id) so each person appears
      -- exactly once regardless of how many events they were connected at.
      -- source_event_id = the earliest event (first connection point).
      ghost_rows AS (
        SELECT
          NULL::uuid                                        AS relationship_id,
          'ghost_claimed'                                   AS status,
          'ghost_claimed'                                   AS relationship_label,
          ie.to_profile_id                                  AS other_profile_id,
          COUNT(DISTINCT ie.event_id)::int                  AS encounter_count,
          MIN(ie.created_at)                                AS first_encounter_at,
          MAX(ie.created_at)                                AS last_encounter_at,
          NULL::timestamptz                                 AS confirmed_at,
          -- Pick event_id from the earliest interaction row for this person
          (
            SELECT ie2.event_id
            FROM interaction_events ie2
            WHERE ie2.claimed_by_profile_id = v_caller_id
              AND ie2.to_profile_id = ie.to_profile_id
              AND ie2.from_ghost_id IS NOT NULL
            ORDER BY ie2.created_at ASC
            LIMIT 1
          )                                                 AS source_event_id,
          MIN(ie.created_at)                                AS created_at
        FROM interaction_events ie
        WHERE ie.claimed_by_profile_id = v_caller_id
          AND ie.from_ghost_id IS NOT NULL
          AND ie.to_profile_id IS NOT NULL
          AND ie.to_profile_id NOT IN (SELECT other_profile_id FROM rel_rows)
          AND p_status IN ('confirmed', 'all')
        GROUP BY ie.to_profile_id
      ),

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
