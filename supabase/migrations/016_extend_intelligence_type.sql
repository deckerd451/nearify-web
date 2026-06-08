-- ============================================================
-- Migration 016: Extend interaction_intelligence type enum
-- ============================================================
-- Adds 're_engaged' to the type CHECK constraint so migration 019
-- can write re-engagement records for confirmed pairs who co-attend
-- a new event. Must be applied before 019.
-- ============================================================

ALTER TABLE interaction_intelligence
  DROP CONSTRAINT interaction_intelligence_type_check,
  ADD CONSTRAINT interaction_intelligence_type_check
    CHECK (type IN ('recommended', 'missed', 'follow_up', 're_engaged'));

-- ============================================================
-- Verification
-- ============================================================
-- Run after applying. Expected: one row, check_clause contains 're_engaged'.
--
-- SELECT constraint_name, check_clause
-- FROM information_schema.check_constraints
-- WHERE constraint_name = 'interaction_intelligence_type_check';
--
-- Smoke-test that the new value is accepted (then rollback):
-- BEGIN;
--   INSERT INTO interaction_intelligence
--     (event_id, profile_id, target_profile_id, score, reason, type)
--   VALUES
--     (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
--      100.0, 'test', 're_engaged');
-- ROLLBACK;
-- ============================================================
