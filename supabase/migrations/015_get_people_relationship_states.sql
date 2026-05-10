-- Returns one row per person the current user has any interaction signal with,
-- deriving a single relationship state from the strongest available signal:
--
--   encountered  — claimed ghost interaction only (one-sided event memory)
--   repeated     — ≥2 interactions or seen at ≥2 events
--   connected    — at least one qr_confirmed or proximity interaction
--
-- The caller (iOS / web) is responsible for overlaying `savedContact` state
-- for profiles the user has saved to Apple Contacts, since that signal lives
-- client-side and is not stored in the database.

CREATE OR REPLACE FUNCTION public.get_people_relationship_states()
RETURNS TABLE (
  profile_id         uuid,
  name               text,
  avatar_url         text,
  relationship_state text,    -- 'encountered' | 'repeated' | 'connected'
  encounter_count    int,
  event_count        int,
  last_event_id      uuid,
  last_event_name    text,
  context_label      text,
  last_seen_at       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH my_profile AS (
    SELECT id FROM profiles WHERE user_id = auth.uid()
  ),

  -- Ghost interactions this profile claimed (from_profile_id is NULL on these rows;
  -- claimed_by_profile_id marks ownership after claim_ghost_activity).
  ghost_claimed AS (
    SELECT
      ie.to_profile_id       AS other_profile_id,
      ie.event_id,
      ie.created_at,
      false                  AS is_confirmed   -- ghost_connect is never qr_confirmed
    FROM interaction_events ie
    JOIN my_profile mp ON ie.claimed_by_profile_id = mp.id
    WHERE ie.to_profile_id     IS NOT NULL
      AND ie.interaction_type  = 'ghost_connect'
  ),

  -- Direct profile-to-profile interactions (proximity, qr_confirmed).
  -- from_profile_id IS NOT NULL guards against double-counting ghost rows.
  direct AS (
    SELECT
      CASE
        WHEN ie.from_profile_id = mp.id THEN ie.to_profile_id
        ELSE ie.from_profile_id
      END                                    AS other_profile_id,
      ie.event_id,
      ie.created_at,
      ie.interaction_type = 'qr_confirmed'   AS is_confirmed
    FROM interaction_events ie
    JOIN my_profile mp
      ON ie.from_profile_id = mp.id
      OR ie.to_profile_id   = mp.id
    WHERE ie.from_profile_id IS NOT NULL
      AND ie.to_profile_id   IS NOT NULL
  ),

  combined AS (
    SELECT * FROM ghost_claimed
    UNION ALL
    SELECT * FROM direct
  ),

  agg AS (
    SELECT
      c.other_profile_id,
      COUNT(*)                                                         AS encounter_count,
      COUNT(DISTINCT c.event_id)                                       AS event_count,
      bool_or(c.is_confirmed)                                          AS has_confirmed,
      MAX(c.created_at)                                                AS last_seen_at,
      (array_agg(c.event_id ORDER BY c.created_at DESC NULLS LAST))[1] AS last_event_id
    FROM combined c
    GROUP BY c.other_profile_id
  ),

  with_state AS (
    SELECT
      a.*,
      CASE
        WHEN a.has_confirmed                              THEN 'connected'
        WHEN a.encounter_count >= 2 OR a.event_count >= 2 THEN 'repeated'
        ELSE                                                   'encountered'
      END AS relationship_state
    FROM agg a
  )

  SELECT
    ws.other_profile_id                                   AS profile_id,
    p.name,
    p.avatar_url,
    ws.relationship_state,
    ws.encounter_count::int,
    ws.event_count::int,
    ws.last_event_id,
    e.name                                                AS last_event_name,
    CASE ws.relationship_state
      WHEN 'connected' THEN
        'Connected'
      WHEN 'repeated' THEN
        CASE
          WHEN ws.event_count >= 2 THEN 'Seen at ' || ws.event_count || ' events'
          ELSE 'Met ' || ws.encounter_count || ' times'
        END
      ELSE  -- encountered
        'Met at ' || COALESCE(e.name, 'an event')
    END                                                   AS context_label,
    ws.last_seen_at
  FROM with_state ws
  JOIN   profiles p ON p.id  = ws.other_profile_id
  LEFT JOIN events e ON e.id = ws.last_event_id
  ORDER BY
    CASE ws.relationship_state
      WHEN 'connected'   THEN 1
      WHEN 'repeated'    THEN 2
      WHEN 'encountered' THEN 3
      ELSE                    4
    END,
    ws.last_seen_at DESC NULLS LAST;
$$;

REVOKE ALL   ON FUNCTION public.get_people_relationship_states() FROM public;
GRANT EXECUTE ON FUNCTION public.get_people_relationship_states() TO authenticated;
