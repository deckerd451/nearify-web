-- ============================================================
-- Events table RLS policies
--
-- The events table is pre-existing. This migration adds RLS
-- so that:
-- - Anyone can read events (public listing)
-- - Authenticated users can create events
-- - Authenticated users can update/delete their own events
--
-- NOTE: If the events table does not have a created_by column,
-- we add one. If it already exists, the IF NOT EXISTS handles it.
-- ============================================================

-- Add ownership column if missing
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid();

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Anyone can read events (public pages, no auth needed)
DROP POLICY IF EXISTS "Public can read events" ON events;
CREATE POLICY "Public can read events"
  ON events FOR SELECT
  USING (true);

-- Authenticated users can create events
DROP POLICY IF EXISTS "Authenticated users can create events" ON events;
CREATE POLICY "Authenticated users can create events"
  ON events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Owners can update their events
DROP POLICY IF EXISTS "Owners can update events" ON events;
CREATE POLICY "Owners can update events"
  ON events FOR UPDATE
  USING (created_by = auth.uid());

-- Owners can delete their events
DROP POLICY IF EXISTS "Owners can delete events" ON events;
CREATE POLICY "Owners can delete events"
  ON events FOR DELETE
  USING (created_by = auth.uid());
