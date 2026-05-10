CREATE OR REPLACE FUNCTION public.get_public_event_attendees(p_event_id uuid)
RETURNS TABLE (
  profile_id     uuid,
  name           text,
  avatar_url     text,
  intent_primary text,
  status         text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    ea.profile_id,
    p.name,
    p.avatar_url,
    ea.intent_primary,
    NULL::text AS status
  FROM event_attendees ea
  JOIN profiles p ON p.id = ea.profile_id
  WHERE ea.event_id = p_event_id
    AND ea.profile_id IS NOT NULL
  LIMIT 200;
$$;
