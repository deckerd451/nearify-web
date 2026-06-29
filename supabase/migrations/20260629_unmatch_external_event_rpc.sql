-- SECURITY DEFINER RPC: unmatch_external_event
--
-- Sets external_events.matched_event_id = NULL for a given row.
-- Runs as the DB owner so it bypasses any RLS WITH CHECK constraints
-- that block client-side nullification of matched_event_id.
-- Restricted to authenticated users; the caller must supply a valid
-- JWT (i.e. be signed in) or the function raises an error.

CREATE OR REPLACE FUNCTION unmatch_external_event(p_ext_id uuid)
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE external_events
     SET matched_event_id = NULL,
         updated_at       = now()
   WHERE id = p_ext_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'external_event not found: %', p_ext_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
