-- Manual-unmatch override for external_events
--
-- Problem: an external sync process (Cloudflare Worker) periodically upserts
-- external_events rows and can reassign matched_event_id after an admin removes
-- a match.  We need a durable signal that tells every write path "the admin
-- explicitly removed this match — do not re-match automatically."
--
-- Solution:
--   1. Two new nullable columns that record the manual removal.
--   2. A BEFORE UPDATE trigger that enforces the override at the DB layer so
--      ANY writer (external sync, RPC, direct client) is blocked from setting
--      matched_event_id back unless it also clears the override flag first.
--   3. Updated unmatch_external_event RPC that stamps the new columns.
--   4. New link_external_event RPC used by the admin Activate flow; it clears
--      the override so an admin can intentionally re-match after removing.

-- ── 1. Columns ────────────────────────────────────────────────────────────────

ALTER TABLE external_events
  ADD COLUMN IF NOT EXISTS manually_unmatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS manually_unmatched_by uuid;

-- ── 2. Guard trigger ──────────────────────────────────────────────────────────
-- Fires BEFORE every UPDATE on external_events.
-- Rule: if the row carries a manual-unmatch stamp AND the incoming write tries
-- to set matched_event_id to a non-null value WITHOUT clearing the stamp,
-- silently force matched_event_id back to NULL.  This makes the protection
-- automatic for ALL writers including the external sync worker.

CREATE OR REPLACE FUNCTION guard_manual_unmatch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.manually_unmatched_at IS NOT NULL
     AND NEW.matched_event_id   IS NOT NULL
     AND NEW.manually_unmatched_at IS NOT NULL
  THEN
    -- External writer tried to re-match a manually-unmatched row.
    -- Reset the incoming matched_event_id to preserve the override.
    NEW.matched_event_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_manual_unmatch ON external_events;
CREATE TRIGGER trg_guard_manual_unmatch
  BEFORE UPDATE ON external_events
  FOR EACH ROW EXECUTE FUNCTION guard_manual_unmatch();

-- ── 3. unmatch_external_event (updated) ──────────────────────────────────────
-- Stamps matched_event_id = NULL plus the override columns.
-- SECURITY DEFINER so it bypasses any RLS WITH CHECK on matched_event_id.

CREATE OR REPLACE FUNCTION unmatch_external_event(p_ext_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE external_events
     SET matched_event_id      = NULL,
         manually_unmatched_at = now(),
         manually_unmatched_by = auth.uid(),
         updated_at            = now()
   WHERE id = p_ext_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'external_event not found: %', p_ext_id;
  END IF;
END;
$$;

-- ── 4. link_external_event ────────────────────────────────────────────────────
-- Used by the admin Activate flow to explicitly (re-)match an external event
-- to a Nearify event.  Clears the manual-unmatch override so subsequent syncs
-- can update the row normally.
-- SECURITY DEFINER for the same RLS reason as unmatch_external_event.

CREATE OR REPLACE FUNCTION link_external_event(
  p_ext_id          uuid,
  p_nearify_event_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE external_events
     SET matched_event_id      = p_nearify_event_id,
         manually_unmatched_at = NULL,
         manually_unmatched_by = NULL,
         updated_at            = now()
   WHERE id = p_ext_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'external_event not found: %', p_ext_id;
  END IF;
END;
$$;

-- Restrict both RPCs to authenticated users only
REVOKE EXECUTE ON FUNCTION unmatch_external_event(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION unmatch_external_event(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION link_external_event(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION link_external_event(uuid, uuid) TO authenticated;
