-- ============================================================
-- Nearify Intelligence Schema Migration
-- Phase 1: Extend event_attendees, create interaction tables
-- ============================================================

-- 1) Extend event_attendees with intent + context columns
ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS intent_primary   text,
  ADD COLUMN IF NOT EXISTS intent_secondary text[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS goals            jsonb         DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS constraints      jsonb         DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS energy_level     int,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz   DEFAULT now();

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_attendees_updated ON event_attendees;
CREATE TRIGGER trg_event_attendees_updated
  BEFORE UPDATE ON event_attendees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) interaction_events — raw signals from iOS
CREATE TABLE IF NOT EXISTS interaction_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid        NOT NULL REFERENCES events(id),
  from_profile_id   uuid        NOT NULL REFERENCES profiles(id),
  to_profile_id     uuid        NOT NULL REFERENCES profiles(id),
  interaction_type  text        NOT NULL CHECK (interaction_type IN ('proximity', 'qr_confirmed')),
  strength          float       DEFAULT 0,
  dwell_seconds     int         DEFAULT 0,
  signal_strength   float       DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interaction_events_event   ON interaction_events(event_id);
CREATE INDEX IF NOT EXISTS idx_interaction_events_from    ON interaction_events(from_profile_id);
CREATE INDEX IF NOT EXISTS idx_interaction_events_to      ON interaction_events(to_profile_id);

-- 3) interaction_intelligence — computed recommendations
CREATE TABLE IF NOT EXISTS interaction_intelligence (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid        NOT NULL REFERENCES events(id),
  profile_id          uuid        NOT NULL REFERENCES profiles(id),
  target_profile_id   uuid        NOT NULL REFERENCES profiles(id),
  score               float       NOT NULL DEFAULT 0,
  reason              text,
  type                text        NOT NULL CHECK (type IN ('recommended', 'missed', 'follow_up')),
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_event    ON interaction_intelligence(event_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_profile  ON interaction_intelligence(profile_id);
