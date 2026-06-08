# Persistent Relationships — Architecture Design

**Date:** 2026-06-08 (revised)  
**Prerequisite:** `docs/INNOVATION_ENGINE_AUDIT.md`, `docs/NEARIFY_THESIS.md`  
**Constraint:** No new profile entity. No new auth system. Minimum schema delta.  
**Identity rule:** All relationship edges use `profiles.id`. `auth.users.id` never appears in this design.  
**North Star:** Follow-Ups Completed — defined as connection confirmation, message exchange, or meaningful re-engagement.

---

## Framing

The thesis says Nearify is a **relationship memory system**, not a contact-collection tool. That distinction shapes every decision in this document.

A LinkedIn-style request/accept flow is explicitly the wrong model. It treats connection as a social gesture initiated by one party — a cold ask, with rejection risk and asymmetric social dynamics. Nearify's system already knows, from encounter signals, which pairs have genuine mutual relevance. The user's job is to **confirm** what the system has already observed, not to propose something from scratch.

This design calls the edge a **relationship**, not a connection. The system proposes. The user confirms. The relationship then lives and is tracked over time. The edge is never static — it accumulates encounter history, and that history is the foundation for the thesis's relationship health and fading detection predictions.

---

## Context: What Already Exists

```
profiles            id (PK), user_id (→ auth.users), name, avatar_url, ...
events              id (PK), created_by, starts_at, ends_at, is_active, deleted_at
event_attendees     (event_id, profile_id) PK, intent_primary, intent_secondary[],
                    goals jsonb, constraints jsonb, energy_level, updated_at
interaction_events  id (PK), event_id, from_profile_id, to_profile_id,
                    from_ghost_id, to_ghost_id, interaction_type, strength,
                    dwell_seconds, signal_strength, created_at
interaction_intelligence  id (PK), event_id, profile_id, target_profile_id,
                          score, reason, type (recommended|missed|follow_up), created_at
ghost_participants  id (PK), event_id, ghost_token, display_name,
                    claimed_by_profile_id, created_at
```

Key invariant: `current_profile_id()` resolves `auth.uid()` → `profiles.id`.  
All RLS policies and RPCs use this function as the access gate.

---

## 1. The `relationships` Table

### 1.1 Column Specification

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `profile_a_id` | uuid | NOT NULL, FK → profiles(id) | Canonical ordering: `profile_a_id < profile_b_id` (UUID sort). No requester/addressee asymmetry. |
| `profile_b_id` | uuid | NOT NULL, FK → profiles(id) | |
| `status` | text | NOT NULL, CHECK (proposed\|confirmed\|snoozed) | See lifecycle section |
| `proposed_by_id` | uuid | NOT NULL, FK → profiles(id) | Which profile tapped "Confirm" first |
| `source_event_id` | uuid | NOT NULL, FK → events(id) | Event where the system first proposed this relationship |
| `source_intelligence_id` | uuid | NULLABLE, FK → interaction_intelligence(id) | The specific intelligence record that drove the proposal |
| `first_encounter_at` | timestamptz | NOT NULL | Timestamp of the earliest `interaction_events` signal between this pair; populated at proposal time |
| `confirmed_at` | timestamptz | NULLABLE | When the second profile confirmed. NULL = still proposed or snoozed |
| `last_encounter_at` | timestamptz | NULLABLE | Updated by `compute_interaction_intelligence()` on each co-attendance after confirmation |
| `encounter_count` | int | NOT NULL, default 1 | Incremented by `compute_interaction_intelligence()` on each co-attendance. 1 = the founding event |
| `created_at` | timestamptz | NOT NULL, default now() | When the row was first written |

**Why `profile_a_id < profile_b_id` instead of requester/addressee?**  
The pair is symmetric by design. Either party may confirm. Canonical ordering on UUID ensures one row per pair, no directional confusion, and a clean unique constraint without needing LEAST/GREATEST expressions everywhere.

### 1.2 Uniqueness Constraint

```
UNIQUE (profile_a_id, profile_b_id)
```

One row per undirected pair, ever. Status transitions happen on that row. There is no "re-initiation" because there is no cold request — the system reproposed via intelligence output when conditions warrant.

### 1.3 Indexes Required

| Index | Columns | Rationale |
|---|---|---|
| Primary | `id` | Default PK lookup |
| `idx_relationships_a` | `profile_a_id, status` | "My relationships" list (half the pairs) |
| `idx_relationships_b` | `profile_b_id, status` | "My relationships" list (other half) |
| `idx_relationships_source_event` | `source_event_id` | "Relationships from this event" analytics |
| `idx_relationships_last_encounter` | `last_encounter_at` | Relationship health queries; fading detection |
| `idx_relationships_encounter_count` | `encounter_count` | Sorting by relationship depth |

### 1.4 Health Columns Are Not Derived

`last_encounter_at` and `encounter_count` are stored columns, not computed at query time. This is intentional:

- Relationship health queries run frequently (home screen, briefings, fading alerts).
- Computing them at query time would require joining `event_attendees` across all events for all of a user's relationships on every load.
- `compute_interaction_intelligence()` already iterates every attendee pair at an event — updating these two columns is a zero-cost addition to that loop.

### 1.5 What Is Not Stored Here

- **Message threads** — not in scope. The relationship edge is not a container.
- **Relationship strength score** — not a stored column in V1. Derivable from `encounter_count` and `last_encounter_at` decay at query time. A stored `strength` column is a future optimization once the decay formula is validated.
- **Ghost relationships** — ghosts cannot hold persistent relationships. A ghost must be claimed (`claimed_by_profile_id`) before their interactions can seed a proposal.

---

## 2. Relationship Lifecycle

### 2.1 State Machine

```
                [proposed]
               /     |     \
              /      |      \
    profile_a    profile_b    either party
    confirms     confirms     snoozes
       |             |             |
       |             |             ▼
       |             |         [snoozed]
       └──── both ───┘             |
              |                    | system re-surfaces
              ▼                    | at next co-attendance
          [confirmed] ◄────────────┘
              |
              │  (lives here indefinitely)
              │  encounter_count and last_encounter_at
              │  update on each co-attendance
              ▼
          (no terminal state in V1)
```

### 2.2 Status Semantics

| Status | Meaning | Who can set it |
|---|---|---|
| `proposed` | System identified this pair as a strong match; one party has seen the card; neither has confirmed | Set by system when first party taps "Confirm this relationship" (see §3) |
| `confirmed` | Both parties have acknowledged the relationship | Set when second party confirms |
| `snoozed` | User dismissed the card; do not surface again until a new co-attendance signal arrives | Set by either party individually; stored as a flag on the row, not a global status change |

**On snooze:** the row status remains `proposed` but a `snoozed_by_a` / `snoozed_by_b` boolean column (or a separate `relationship_snoozes` table if snooze needs expiry) suppresses the card for the snoozed party. At the next co-attendance, the intelligence update clears the snooze and re-surfaces the card with updated context.

**No "disconnect" in V1.** Confirmed relationships are not deleted. The relationship history is the product's memory — removing it severs the record of where and how the relationship began. Dormancy is tracked through `last_encounter_at` and surfaced as a health signal, not a deletion.

### 2.3 Confirmation Asymmetry

Because either party can confirm first, confirmation is tracked on the `relationships` row as `proposed_by_id` (first confirmer) and `confirmed_at` (when the second confirmer acted). The system shows the card to both parties independently via their intelligence output. The first to confirm sets `proposed_by_id`; the second sets `confirmed_at = now()` and transitions status to `confirmed`.

This means:
- Party A sees the card, taps "Confirm." Row is created with `status = proposed`, `proposed_by_id = A`.
- Party B sees the same card (independently, from their own intelligence output), taps "Confirm." Row updates to `status = confirmed`, `confirmed_at = now()`.
- If Party B snoozes instead, the row stays `proposed`. Party A is not notified of the snooze.
- If neither confirms within 90 days and they attend no further shared events, the row remains `proposed` and is effectively dormant.

**The Follow-Up Completed event fires when `status` transitions to `confirmed`.** This is the north star metric increment.

---

## 3. Confirmation Flow

### 3.1 How a Relationship Is Proposed

The system proposes a relationship when `compute_interaction_intelligence()` produces a `recommended` or `follow_up` type record for a pair. The intelligence card rendered from `get_my_intelligence()` is the proposal surface. The CTA is **"Confirm this relationship"**, not "Connect."

Language matters here. "Connect" implies a cold ask. "Confirm" signals that the system has observed something real and is asking the user to acknowledge it. The encounter already happened. The relationship may already exist informally. The confirmation is the explicit acknowledgment that makes it persistent.

### 3.2 Confirmation Action (First Party)

**Preconditions checked by RPC:**
1. `current_profile_id()` is not null.
2. `current_profile_id() ≠ p_other_profile_id`.
3. No existing `relationships` row for this pair (UNIQUE constraint; RPC returns an idempotent success if one already exists).

**On success:**
- Row is inserted with `status = 'proposed'`, `proposed_by_id = current_profile_id()`.
- `first_encounter_at` is populated by querying the earliest `interaction_events.created_at` for this pair across all events.
- `source_event_id` and `source_intelligence_id` are stored from the intelligence card context.
- `encounter_count = 1`.

**RPC signature (conceptual):**
```
confirm_relationship(
  p_other_profile_id     uuid,
  p_source_event_id      uuid,
  p_source_intel_id      uuid  DEFAULT NULL
) RETURNS jsonb
  -- { relationship_id, status, first_encounter_at }
  -- Idempotent: returns existing row if already proposed/confirmed
```

### 3.3 Confirmation Action (Second Party)

The second party sees the same intelligence card in their own `get_my_intelligence()` output. The card shows that the other person has already confirmed (via `relationship_status` field on the card — see §4.4). The CTA changes from "Confirm" to **"They confirmed — confirm back."**

**On second confirmation:**
- UPDATE `relationships SET status = 'confirmed', confirmed_at = now()` WHERE pair matches and `status = 'proposed'`.
- RLS: either profile in the pair may update.
- **Follow-Up Completed event is recorded here.** This is the north star metric increment.

No separate RPC needed — `confirm_relationship()` is idempotent and handles both the first and second confirmation by checking the existing row state.

### 3.4 Snooze Action

The snooze action suppresses the card without creating social signal. It is not communicated to the other party.

**On snooze:**
- If no row exists yet, insert with `status = 'proposed'`, `proposed_by_id = NULL`, `snoozed_by_a` or `snoozed_by_b = true` depending on which profile snoozed.
- If row exists, UPDATE the snooze flag for the snoozed party.
- The card does not reappear in `get_my_intelligence()` output for the snoozed party until `compute_interaction_intelligence()` clears the snooze on a new co-attendance signal.

**RPC signature (conceptual):**
```
snooze_relationship(
  p_other_profile_id  uuid,
  p_source_event_id   uuid
) RETURNS void
```

### 3.5 Notification Delivery

Same principle as the original design: the `relationships` table does not own notification delivery. The application layer dispatches notifications after successful RPC responses.

- **On first confirmation:** no notification to other party in V1. Their intelligence card already surfaces the relationship with updated status. A notification is a future addition.
- **On second confirmation (mutual):** notify both parties that the relationship is confirmed.
- **On snooze:** no notification to either party.

---

## 4. Cross-Event Scoring Updates

### 4.1 The Problem

`compute_interaction_intelligence()` currently clears and rewrites all intelligence rows for an event. It scores only within that event's signals. It is blind to:

- Whether two profiles have an existing relationship and what its health is.
- Whether two profiles have met at previous events (without a formal relationship).
- What their accumulated signal history looks like over time.

### 4.2 The Re-Engagement Rule (Replaces Suppression)

**Already-confirmed pairs must not be suppressed from intelligence output.**

The original design proposed skipping these pairs. That was wrong. A confirmed pair co-attending a new event is a relationship health signal — it tells the system the relationship is active. Discarding it removes the data the thesis needs to track relationship strength and detect fading.

The correct behavior:

1. When `compute_interaction_intelligence()` finds a pair with an existing `confirmed` relationship, **update the health columns** on the `relationships` row:
   ```
   UPDATE relationships
   SET last_encounter_at = now(),
       encounter_count = encounter_count + 1
   WHERE (profile_a_id, profile_b_id) = (canonical pair)
     AND status = 'confirmed'
   ```

2. Write the intelligence row with `type = 're_engaged'` — a new type alongside `recommended`, `missed`, `follow_up`. The card renders as "You're both here again" rather than a proposal.

3. The `'re_engaged'` type is additive to the CHECK constraint on `interaction_intelligence.type`. No other table changes.

**Why retain the intelligence row?** The `re_engaged` record in `interaction_intelligence` provides the event-scoped timeline entry that feeds the relationship history surface (see §5). Without it, there is no durable record that the pair co-attended this event.

### 4.3 The Historical Signal Bonus (No Change from Original)

For pairs with no existing relationship, the historical shared-event bonus remains as designed:

```
shared_event_count = COUNT(DISTINCT event_id)
  FROM event_attendees for profile_a
  JOIN event_attendees for profile_b ON same event_id
  WHERE event predates current event
```

Score bonus: `MIN(shared_event_count × 5.0, 20.0)` — capped at 20 points.  
Reason text: `"You've both attended N previous events."` when count > 0.

This is computed from `event_attendees` with no new columns.

### 4.4 The `relationship_status` Field on Intelligence Output

`get_my_intelligence()` is extended to left-join `relationships` on the pair and return a `relationship_status` field:

| Value | Meaning | CTA rendered |
|---|---|---|
| `null` | No relationship row exists | "Confirm this relationship" |
| `proposed_by_me` | Row exists, `proposed_by_id = viewer` | "Waiting for them to confirm" |
| `proposed_by_them` | Row exists, proposed by the other profile | "They confirmed — confirm back" |
| `confirmed` | Mutual confirmation | "You're in each other's networks" (no CTA) |
| `re_engaged` | Confirmed pair, co-attending again | "You're both here again — say hi" |

This is a query-time join. No schema change to `interaction_intelligence`.

### 4.5 Pending Pairs for `proposed` Relationships

`compute_interaction_intelligence()` updates `last_encounter_at` and `encounter_count` for `confirmed` pairs. For `proposed` pairs (one party has confirmed, other has not), no update occurs — co-attendance does not implicitly confirm. The intelligence card re-surfaces with updated score from fresh signals, giving the non-confirming party another opportunity to confirm.

### 4.6 Score Decay (Future, Not V1)

Intelligence scores have no time dimension in the current system. A `score_decayed` column based on event recency is a future enhancement. Relationship health (via `last_encounter_at` and `encounter_count`) is the V1 proxy for this.

---

## 5. Profile Page Changes

### 5.1 New Data Surfaces

The public profile page currently shows name, avatar, and a brief from `get_public_profile_brief()`.

With persistent relationships, the following surfaces are added:

**Relationship status**  
Shown when the viewer is authenticated. Derived from `get_relationship_context()`. States map to CTAs as described in §4.4.

**Encounter history summary**  
Always visible when encounter data exists. Derived from the `relationships` row and `event_attendees` join.

| Data point | Source | Label example |
|---|---|---|
| First encounter | `relationships.first_encounter_at` + `events.name` | "First met at [Event Name]" |
| Total co-attendances | `relationships.encounter_count` | "Together at 4 events" |
| Most recent co-attendance | `relationships.last_encounter_at` + event lookup | "Last seen at [Event Name], 3 weeks ago" |
| Shared intent pattern | Most frequent `event_attendees.intent_primary` across shared events | "Usually both here to: find_cofounder" |

For pairs with no `relationships` row, the encounter history is still computable from `event_attendees` — it just has no confirmation status attached.

**Relationship health signal (authenticated, confirmed pairs only)**  
Surfaces a contextual note based on `last_encounter_at` decay:
- < 60 days: no note (relationship is active)
- 60–180 days: "You haven't crossed paths in a while"
- \> 180 days: "This relationship may be fading — look for them at your next event"

The decay thresholds are application-layer logic, not stored in the DB.

### 5.2 What Does Not Change

`get_public_profile_brief()` signature is unchanged. All new data is fetched by a separate `get_relationship_context()` RPC.

### 5.3 New RPC: `get_relationship_context`

```
get_relationship_context(p_other_profile_id uuid)
RETURNS jsonb
  -- {
  --   relationship_status:        null | 'proposed_by_me' | 'proposed_by_them'
  --                               | 'confirmed' | 'none',
  --   relationship_id:            uuid | null,
  --   first_encounter_at:         timestamptz | null,
  --   first_encounter_event_name: text | null,
  --   last_encounter_at:          timestamptz | null,
  --   last_encounter_event_name:  text | null,
  --   encounter_count:            int,
  --   shared_intent:              text | null
  -- }
```

When unauthenticated, returns `encounter_count` and shared event history only (public data); `relationship_status` and `relationship_id` are null.

---

## 6. Migration Plan

### 6.1 Zero-Downtime Constraint

All changes are additive. No existing table columns are dropped or renamed. No existing RPC signatures change. Existing callers receive new fields and can ignore them.

### Step 1 — Extend `interaction_intelligence` type enum

Add `re_engaged` to the CHECK constraint on `interaction_intelligence.type`. This must be done before Step 3 modifies `compute_interaction_intelligence()`.

```sql
ALTER TABLE interaction_intelligence
  DROP CONSTRAINT interaction_intelligence_type_check,
  ADD CONSTRAINT interaction_intelligence_type_check
    CHECK (type IN ('recommended', 'missed', 'follow_up', 're_engaged'));
```

### Step 2 — Add `relationships` table

Creates the table, unique index, all auxiliary indexes, and RLS policies from §1.

**RLS policies:**
- SELECT: `profile_a_id = current_profile_id() OR profile_b_id = current_profile_id()`
- INSERT: `proposed_by_id = current_profile_id()` AND either `profile_a_id` or `profile_b_id` equals `current_profile_id()`
- UPDATE: `profile_a_id = current_profile_id() OR profile_b_id = current_profile_id()` AND `status != 'confirmed'` (confirmed rows are immutable except by `compute_interaction_intelligence()` updating health columns, which runs as SECURITY DEFINER)

### Step 3 — Add RPCs

Two new RPCs in a single migration file:
- `confirm_relationship()` — handles both first and second confirmation; idempotent
- `snooze_relationship()`
- `get_relationship_context()`

### Step 4 — Patch `compute_interaction_intelligence()`

Behavioral changes:
1. For `confirmed` pairs: UPDATE `relationships` health columns + write `re_engaged` intelligence row instead of skipping.
2. For `proposed` pairs: re-score with fresh signals; update the intelligence row score/reason so the card shows updated context. Do not auto-confirm.
3. For unrelated pairs: add historical shared-event bonus to score (from §4.3). Clear snooze flags.

### Step 5 — Patch `get_my_intelligence()`

Add `relationship_status` field to returned JSONB via left-join on `relationships`. No signature change; new field is additive.

### Step 6 — Patch `get_public_event_attendees()`

Add `relationship_status` column (authenticated callers only). Unauthenticated callers receive `null`.

### 6.2 Migration File Sequence

```
supabase/migrations/016_extend_intelligence_type.sql
  -- ALTER TABLE interaction_intelligence: add 're_engaged' to CHECK

supabase/migrations/017_relationships_table.sql
  -- CREATE TABLE relationships
  -- UNIQUE index on (profile_a_id, profile_b_id)
  -- Auxiliary indexes
  -- RLS policies

supabase/migrations/018_relationship_rpcs.sql
  -- confirm_relationship()
  -- snooze_relationship()
  -- get_relationship_context()

supabase/migrations/019_patch_intelligence_for_relationships.sql
  -- CREATE OR REPLACE FUNCTION compute_interaction_intelligence()
  --   adds re-engagement update + 're_engaged' type
  --   adds historical bonus for unrelated pairs
  --   clears snooze flags on new co-attendance
  -- CREATE OR REPLACE FUNCTION get_my_intelligence()
  --   adds relationship_status field

supabase/migrations/020_patch_public_attendees_relationship_status.sql
  -- CREATE OR REPLACE FUNCTION get_public_event_attendees()
  --   adds relationship_status column
```

### 6.3 Backfill Strategy

No backfill for existing pairs. The `relationships` table starts empty. The first time two profiles co-attend an event after deployment, `compute_interaction_intelligence()` creates a new `recommended` intelligence row with the historical bonus if applicable. The user confirms from that card.

No synthetic relationship rows are created from historical data. An accepted relationship requires explicit acknowledgment from both parties. Historical `interaction_events` data is preserved and will contribute to the historical bonus score on future events.

### 6.4 Rollback Plan

| Step | Rollback |
|---|---|
| 016 | Revert CHECK constraint to original three values. Any existing `re_engaged` rows must be deleted first (none exist before Step 4 runs). |
| 017 | `DROP TABLE relationships CASCADE`. No existing data affected. |
| 018 | `DROP FUNCTION` for each new RPC. |
| 019 | Re-deploy previous `compute_interaction_intelligence()` and `get_my_intelligence()` bodies. |
| 020 | Re-deploy previous `get_public_event_attendees()` body. |

---

## 7. Relationship to Thesis Roadmap

| Thesis Priority | This Design Provides |
|---|---|
| Priority 1: Relationship Memory | `first_encounter_at`, `source_event_id` — persistent record of where the relationship began. Encounter timeline derivable from `re_engaged` intelligence rows. |
| Priority 1: Follow-up detection | `confirmed_at` transition = Follow-Up Completed (north star metric). `re_engaged` events = subsequent follow-up signals. |
| Priority 2: Explanation | `source_intelligence_id` links the confirmed relationship back to the scored encounter that produced it. `reason` text from intelligence carries forward. |
| Priority 3: Relationship health | `last_encounter_at` + `encounter_count` are the primitive inputs for strengthening/fading detection. Health labels on profile page are the first surface. |
| Priority 3: Dormant relationships | `last_encounter_at` decay threshold (180 days) produces the first fading signal. |
| Priority 4: Ambient intelligence | Not addressed in V1. Requires historical `relationships` data to train on. This design accumulates that data. |

**What this design does not yet enable:**
- Relationship trajectory prediction (Priority 4) — requires more history than V1 will have.
- "This relationship is fading" push notification — notification infrastructure is not in scope here.
- Relationship strength as a stored, continuously updated score — derivable from existing columns but not materialized in V1.

---

## Summary: What Changes, What Doesn't

| Component | Change |
|---|---|
| `profiles` | No change |
| `events` | No change |
| `event_attendees` | No change |
| `interaction_events` | No change |
| `interaction_intelligence` | CHECK constraint extended to include `re_engaged`; compute + query functions updated |
| `ghost_participants` | No change |
| `relationships` | **New table** |
| `compute_interaction_intelligence()` | Patched: re-engagement update, historical bonus, snooze clearing |
| `get_my_intelligence()` | Patched: adds `relationship_status` field |
| `get_public_event_attendees()` | Patched: adds `relationship_status` field |
| `get_relationship_context()` | **New RPC** |
| `confirm_relationship()` | **New RPC** |
| `snooze_relationship()` | **New RPC** |
| `get_public_profile_brief()` | No change |

5 new migrations. 3 patched RPCs. 3 new RPCs. 1 new table. 1 extended CHECK constraint.
