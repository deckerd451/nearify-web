-- ============================================================
-- Events table RLS policies
--
-- Identity model:
--   profiles.id is used for ALL ownership relationships.
--   profiles.auth_user_id references auth.users.id.
--   events.created_by references profiles.id.
--
-- This migration:
-- 1. Adds created_by column referencing profiles(id)
-- 2. Enables RLS on events
-- 3. Public SELECT for all visitors
-- 4. INSERT/UPDATE/DELETE restricted to the owning profile
-- ============================================================

-- Add ownership column if missing (references profiles, not auth.users)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id);

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Anyone can read events (public pages, no auth needed)
DROP POLICY IF EXISTS "Public can read events" ON events;
CREATE POLICY "Public can read events"
  ON events FOR SELECT
  USING (true);

-- Authenticated users can create events (created_by must match their profile)
DROP POLICY IF EXISTS "Authenticated users can create events" ON events;
CREATE POLICY "Authenticated users can create events"
  ON events FOR INSERT
  WITH CHECK (created_by = current_profile_id());

-- Owners can update their events
DROP POLICY IF EXISTS "Owners can update events" ON events;
CREATE POLICY "Owners can update events"
  ON events FOR UPDATE
  USING (created_by = current_profile_id());

-- Owners can delete their events
DROP POLICY IF EXISTS "Owners can delete events" ON events;
CREATE POLICY "Owners can delete events"
  ON events FOR DELETE
  USING (created_by = current_profile_id());
