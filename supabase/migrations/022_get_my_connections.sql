-- 022_get_my_connections.sql
-- New read-only RPC that returns all relationships for the calling user.
-- Used by the /connections/ page to list claimed and confirmed connections.
--
-- No schema changes. Reads: relationships, profiles, events.
-- The relationships table uses canonical ordering (profile_a_id < profile_b_id),
-- so this function resolves the "other" profile correctly regardless of which
-- side the caller appears on.

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
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT
          r.id                    AS relationship_id,
          r.status,
          CASE
            WHEN r.status = 'confirmed'                    THEN 'confirmed'
            WHEN r.proposed_by_id = v_caller_id            THEN 'proposed_by_me'
            WHEN r.proposed_by_id IS NOT NULL              THEN 'proposed_by_them'
            ELSE 'proposed'
          END                     AS relationship_label,
          p.id                    AS profile_id,
          p.name,
          p.avatar_url,
          r.encounter_count,
          r.first_encounter_at,
          r.last_encounter_at,
          r.confirmed_at,
          e.name                  AS first_encounter_event_name,
          r.source_event_id,
          r.created_at
        FROM relationships r
        JOIN profiles p ON p.id = CASE
          WHEN r.profile_a_id = v_caller_id THEN r.profile_b_id
          ELSE r.profile_a_id
        END
        LEFT JOIN events e ON e.id = r.source_event_id
        WHERE
          (r.profile_a_id = v_caller_id OR r.profile_b_id = v_caller_id)
          AND (p_status = 'all' OR r.status = p_status)
        ORDER BY
          r.last_encounter_at DESC NULLS LAST,
          r.created_at DESC
      ) t
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_connections(text) TO authenticated;
