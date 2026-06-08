-- ============================================================
-- Migration 017: Create relationships table
-- ============================================================
-- Persistent, undirected relationship edges between profiles.
-- Each row represents one pair. Status progresses from proposed
-- to confirmed as both parties acknowledge the relationship.
--
-- Canonical ordering invariant:
--   profile_a_id = LEAST(uuid_1, uuid_2)   (lexicographic)
--   profile_b_id = GREATEST(uuid_1, uuid_2)
-- Enforced by all writer RPCs, not by a DB constraint.
--
-- Health columns (last_encounter_at, encounter_count) are updated
-- by compute_interaction_intelligence() on each co-attendance after
-- a relationship is confirmed. They are the primitive inputs for
-- relationship strength and fading detection.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.relationships (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Undirected pair: profile_a_id < profile_b_id (UUID lexicographic)
  profile_a_id            uuid        NOT NULL REFERENCES public.profiles(id),
  profile_b_id            uuid        NOT NULL REFERENCES public.profiles(id),

  -- Lifecycle
  status                  text        NOT NULL DEFAULT 'proposed'
                            CHECK (status IN ('proposed', 'confirmed')),
  proposed_by_id          uuid        REFERENCES public.profiles(id),

  -- Event provenance: where the system first surfaced this relationship
  source_event_id         uuid        NOT NULL REFERENCES public.events(id),
  source_intelligence_id  uuid        REFERENCES public.interaction_intelligence(id),

  -- Relationship history (populated at creation; updated on each co-attendance)
  first_encounter_at      timestamptz NOT NULL,
  confirmed_at            timestamptz,
  last_encounter_at       timestamptz,
  encounter_count         int         NOT NULL DEFAULT 1,

  -- Per-party snooze flags: card suppressed until next co-attendance signal
  snoozed_by_a            boolean     NOT NULL DEFAULT false,
  snoozed_by_b            boolean     NOT NULL DEFAULT false,

  created_at              timestamptz NOT NULL DEFAULT now()
);

-- One row per undirected pair, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_pair
  ON public.relationships (profile_a_id, profile_b_id);

-- "My relationships" — both halves of the undirected pair
CREATE INDEX IF NOT EXISTS idx_relationships_a
  ON public.relationships (profile_a_id, status);

CREATE INDEX IF NOT EXISTS idx_relationships_b
  ON public.relationships (profile_b_id, status);

-- "Relationships originating from an event" (organiser analytics)
CREATE INDEX IF NOT EXISTS idx_relationships_source_event
  ON public.relationships (source_event_id);

-- Relationship health queries and fading detection
CREATE INDEX IF NOT EXISTS idx_relationships_last_encounter
  ON public.relationships (last_encounter_at);

CREATE INDEX IF NOT EXISTS idx_relationships_encounter_count
  ON public.relationships (encounter_count);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

-- Users can only see their own relationship rows.
CREATE POLICY "Users see own relationships"
  ON public.relationships FOR SELECT
  USING (
    profile_a_id = current_profile_id()
    OR profile_b_id = current_profile_id()
  );

-- A user can only create a row in which they appear as one of the pair
-- and they are the proposing party.
CREATE POLICY "Users propose own relationships"
  ON public.relationships FOR INSERT
  WITH CHECK (
    proposed_by_id = current_profile_id()
    AND (
      profile_a_id = current_profile_id()
      OR profile_b_id = current_profile_id()
    )
  );

-- No UPDATE policy: all mutations go through SECURITY DEFINER RPCs
-- (confirm_relationship, snooze_relationship, compute_interaction_intelligence).
-- Direct REST API updates are intentionally blocked.

-- No DELETE policy: relationship history is permanent.

-- ============================================================
-- Verification
-- ============================================================
-- Run after applying.
--
-- 1. Confirm table and columns exist:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'relationships'
-- ORDER BY ordinal_position;
-- Expected: 15 rows covering all columns above.
--
-- 2. Confirm unique index:
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'relationships' AND indexname = 'idx_relationships_pair';
-- Expected: 1 row.
--
-- 3. Confirm RLS is enabled:
-- SELECT relrowsecurity FROM pg_class
-- WHERE relname = 'relationships';
-- Expected: true (t).
--
-- 4. Confirm table is empty:
-- SELECT COUNT(*) FROM relationships;
-- Expected: 0.
-- ============================================================
