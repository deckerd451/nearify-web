-- ============================================================
-- Event Evaluation Migration
-- Adds a status-based approval workflow for organizer events.
--
-- Changes:
-- 1. Add status column to events (pending | approved | rejected)
-- 2. Add admin_note column to events (reason shown on rejection)
-- 3. Add is_admin column to profiles
-- 4. Helper function: current_is_admin()
-- 5. Replace public SELECT policy: public sees only approved events
-- 6. New admin UPDATE policy: admins can update any event
-- ============================================================

-- 1. Status column — new events start as 'pending'
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected'));

-- 2. Admin note (used for rejection reason, visible to organizer)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS admin_note text;

-- 3. Admin flag on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 4. Helper: is the current session user an admin?
CREATE OR REPLACE FUNCTION current_is_admin()
RETURNS boolean AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE user_id = auth.uid()),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5. Replace the public SELECT policy to enforce status filter.
--    Rules:
--    - Admins see all events (any status, deleted or not)
--    - Organizers see their own events (any status, deleted or not)
--    - Everyone else sees only approved + non-deleted events
DROP POLICY IF EXISTS "Public can read events" ON events;
CREATE POLICY "Public can read events"
  ON events FOR SELECT
  USING (
    current_is_admin()
    OR created_by = current_profile_id()
    OR (status = 'approved' AND deleted_at IS NULL)
  );

-- 6. Admins can update any event (to change status, add admin_note, etc.)
DROP POLICY IF EXISTS "Admins can update any event" ON events;
CREATE POLICY "Admins can update any event"
  ON events FOR UPDATE
  USING (current_is_admin());
