# Persistent Connections — Architecture Design

**Date:** 2026-06-08  
**Prerequisite:** `docs/INNOVATION_ENGINE_AUDIT.md`  
**Constraint:** No new profile entity. No new auth system. Minimum schema delta.  
**Identity rule:** All relationship edges use `profiles.id`. `auth.users.id` never appears in this design.

---

## Context: What Already Exists

The schema that this design layers onto:

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

## 1. The `connections` Table

### 1.1 Column Specification

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `requester_id` | uuid | NOT NULL, FK → profiles(id) | Profile that sent the request |
| `addressee_id` | uuid | NOT NULL, FK → profiles(id) | Profile that received the request |
| `status` | text | NOT NULL, CHECK (pending\|accepted\|declined\|withdrawn) | See lifecycle section |
| `source_event_id` | uuid | NULLABLE, FK → events(id) | Event where the match was surfaced; NULL if initiated outside event context |
| `source_intelligence_id` | uuid | NULLABLE, FK → interaction_intelligence(id) | The specific intelligence record that prompted the request; NULL if user-initiated |
| `requester_note` | text | NULLABLE, max 500 chars | Optional short message from requester |
| `created_at` | timestamptz | NOT NULL, default now() | When the request was sent |
| `responded_at` | timestamptz | NULLABLE | When accepted or declined |
| `withdrawn_at` | timestamptz | NULLABLE | When requester withdrew pending request |

### 1.2 Uniqueness Constraint

One undirected pair may have at most one non-withdrawn connection attempt at a time.

```
UNIQUE (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))
  WHERE status IN ('pending', 'accepted')
```

This allows a declined request to be re-initiated later (the old declined row is retained for audit; the constraint only blocks duplicate pending/accepted rows). Implemented as a partial unique index.

### 1.3 Indexes Required

| Index | Columns | Rationale |
|---|---|---|
| Primary | `id` | Default PK lookup |
| `idx_connections_requester` | `requester_id, status` | "My sent requests" list |
| `idx_connections_addressee` | `addressee_id, status` | "My received requests" list; drives badge counts |
| `idx_connections_pair` | `LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id)` | Check if two profiles are already connected |
| `idx_connections_source_event` | `source_event_id` | "Connections from this event" analytics |

### 1.4 What Is Not Stored Here

- **Message threads** — not in scope. A connection is an edge, not a container.
- **Mutual event history** — computed at query time by joining `event_attendees`.
- **Intelligence scores** — stored in `interaction_intelligence`; linked via `source_intelligence_id`.
- **Ghost relationships** — ghosts cannot hold persistent connections. A ghost must be claimed (`claimed_by_profile_id`) before its interactions can seed a connection request.

---

## 2. Connection Lifecycle

### 2.1 State Machine

```
                         ┌─────────────────────────────────┐
                         │                                 │
          requester      ▼                                 │ requester
         sends req   [pending]                             │ re-initiates
               ──────────┤                                 │ (new row)
                         │                                 │
             ┌───────────┼───────────────┐                 │
             │           │               │                 │
          addressee   addressee       requester            │
          accepts     declines        withdraws            │
             │           │               │                 │
             ▼           ▼               ▼                 │
        [accepted]  [declined]      [withdrawn] ───────────┘
             │
         (terminal
          unless
         disconnected
          in future)
```

### 2.2 Status Semantics

| Status | Who sets it | Meaning | Visible to addressee? |
|---|---|---|---|
| `pending` | requester (INSERT) | Waiting for response | Yes — drives badge count |
| `accepted` | addressee (UPDATE) | Mutual connection established | Yes |
| `declined` | addressee (UPDATE) | Request rejected | No — hidden from requester after 24h to reduce friction |
| `withdrawn` | requester (UPDATE) | Requester cancelled before response | No |

**Declined vs withdrawn:** Both are retained for audit and to enforce re-initiation cooldown (see §2.3). Neither is shown in normal UI flows.

### 2.3 Re-initiation Rules

- A requester may not re-send to the same addressee within **30 days** of a declined response.
- A requester may re-send immediately after withdrawing their own pending request.
- Enforcement: checked in the `request_connection` RPC before INSERT (not in the unique constraint, which only blocks duplicate pending/accepted pairs).

### 2.4 No "Unfriend" in V1

Accepted connections are terminal in this design. Disconnection introduces a separate UX surface (confirmation, implicit re-send prevention) that is out of scope. The partial unique index naturally allows a declined row to coexist with a future pending row.

---

## 3. Connection Acceptance Flow

### 3.1 Actors and Surfaces

| Actor | Surface | Action |
|---|---|---|
| User A (requester) | Intelligence card on `profile.html` or post-event recap | Taps "Connect" |
| User B (addressee) | Notification badge → notification panel | Taps "Accept" or "Decline" |
| System | DB trigger or RPC | Records `responded_at`, increments derived counts |

### 3.2 Request Initiation (User A)

**Preconditions checked by RPC before INSERT:**
1. `current_profile_id()` is not null (user is authenticated).
2. `requester_id ≠ addressee_id` (cannot connect to self).
3. No existing `pending` or `accepted` row for this pair (partial unique index enforces; RPC returns a clear error if violated).
4. No `declined` row within the last 30 days for this `(requester_id, addressee_id)` direction.

**On success:**
- Row inserted with `status = 'pending'`.
- If `source_intelligence_id` is provided, it is stored as-is (validated that it belongs to an event both profiles attended).
- No notification is sent by the DB itself — the calling client dispatches a notification via the application layer after a successful RPC response.

**RPC signature (conceptual):**
```
request_connection(
  p_addressee_id         uuid,
  p_source_event_id      uuid  DEFAULT NULL,
  p_source_intel_id      uuid  DEFAULT NULL,
  p_note                 text  DEFAULT NULL
) RETURNS jsonb
  -- returns { connection_id, status, created_at }
  -- raises on constraint violation with a typed error code
```

### 3.3 Response (User B)

**Accept:**
- UPDATE `connections SET status = 'accepted', responded_at = now()` WHERE `id = p_connection_id AND addressee_id = current_profile_id() AND status = 'pending'`.
- RLS enforces that only the addressee can accept.
- On success: both parties' connection counts update (derived; no materialized counter in V1).

**Decline:**
- Same UPDATE pattern but `status = 'declined'`.
- The declined row is retained but hidden from the requester in all UI-facing queries.

**RPC signatures (conceptual):**
```
accept_connection(p_connection_id uuid) RETURNS jsonb
decline_connection(p_connection_id uuid) RETURNS jsonb
```

### 3.4 Notification Delivery

The `connections` table does not store notifications. Notification delivery is handled by the application layer (not the DB) after a successful RPC:

- **On pending insert:** application pushes a notification record for the addressee (future: `notifications` table; V1: Supabase Realtime broadcast or email via Supabase trigger).
- **On accept:** application pushes a notification record for the requester.
- **On decline:** no notification to requester (silent decline).

This keeps notification policy out of the connection schema and makes it easy to change delivery channels without a migration.

### 3.5 Withdraw (User A Cancels)

- UPDATE `connections SET status = 'withdrawn', withdrawn_at = now()` WHERE `id = p_connection_id AND requester_id = current_profile_id() AND status = 'pending'`.
- Clears from addressee's pending queue immediately (RLS on SELECT filters `withdrawn` rows from addressee's view).

---

## 4. Cross-Event Scoring Updates

### 4.1 The Problem

`compute_interaction_intelligence()` currently clears and rewrites all intelligence rows for an event. It scores only within that event's `interaction_events` and `event_attendees`. It is blind to:
- Whether two profiles are already connected.
- Whether two profiles have met at previous events.
- What their accumulated dwell/QR signal history is.

### 4.2 The Suppression Rule

**Already-connected pairs must not appear in intelligence output.**

Mechanism: `compute_interaction_intelligence()` receives the event_id. Before inserting an intelligence row, check whether a `connections` row exists with `status = 'accepted'` for that pair. If yes, skip the INSERT.

This is a single lookup per pair inside the existing loop. It does not require a schema change to the intelligence table.

Pseudologic addition to the existing function:
```
-- Skip if already connected (persistent relationship supersedes event intelligence)
IF EXISTS (
  SELECT 1 FROM connections
  WHERE status = 'accepted'
    AND LEAST(requester_id, addressee_id) = LEAST(v_profile.profile_id, v_target.profile_id)
    AND GREATEST(requester_id, addressee_id) = GREATEST(v_profile.profile_id, v_target.profile_id)
) THEN
  CONTINUE;
END IF;
```

### 4.3 The Historical Signal Bonus

When two profiles have met at prior events (shared `event_attendees` rows across different events), their intelligence score at a new event should be boosted. This captures "we keep running into each other" as a stronger signal than first-encounter proximity.

**Implementation approach — additive score component, computed in-RPC:**

At score time for a `(v_profile, v_target)` pair, count their shared events before the current one:
```
shared_event_count = COUNT(DISTINCT ea1.event_id)
FROM event_attendees ea1
JOIN event_attendees ea2
  ON ea1.event_id = ea2.event_id
  AND ea2.profile_id = v_target.profile_id
JOIN events e ON e.id = ea1.event_id
WHERE ea1.profile_id = v_profile.profile_id
  AND ea1.event_id != p_event_id
  AND e.starts_at < (SELECT starts_at FROM events WHERE id = p_event_id)
```

Score bonus: `MIN(shared_event_count * 5.0, 20.0)` — capped at 20 points to avoid drowning out fresh signals.

Reason text: append `"You've both attended N previous events."` when `shared_event_count > 0`.

**No new columns required.** The bonus is computed from existing `event_attendees` data.

### 4.4 The Pending Request Suppression

If a `connections` row exists with `status = 'pending'` for a pair, the intelligence card for that pair should surface the pending request state rather than a fresh "Connect" prompt. This is a **query-time join**, not a schema change:

`get_my_intelligence()` is extended to left-join `connections` on the pair and return a `connection_status` field (`null`, `pending`, `accepted`). The UI uses this to render the appropriate CTA.

### 4.5 Score Decay (Future, Not V1)

Intelligence scores currently have no time dimension — a high score from 18 months ago is treated identically to one from last week. A `score_decayed` computed column (based on `created_at` and event recency) is a future enhancement. Not designed here.

---

## 5. Profile Page Changes

### 5.1 New Data Surfaces

The public profile page (`profile.html`) currently shows: name, avatar, and a brief from `get_public_profile_brief()`.

With persistent connections, the following surfaces are added:

**Connection status badge**  
Shown when the viewing user is authenticated. Derived from a `connections` lookup for the `(viewer, subject)` pair. Four states: `not_connected`, `pending_sent`, `pending_received`, `connected`. Each maps to a different CTA.

| State | CTA shown to viewer |
|---|---|
| `not_connected` | "Connect" button |
| `pending_sent` | "Request sent" (greyed, with withdraw option) |
| `pending_received` | "Accept" and "Decline" buttons |
| `connected` | "Connected" badge (no action) |

**Mutual events count**  
`COUNT(DISTINCT shared event_ids)` from `event_attendees`. Always visible when > 0. Label: "Met at N events."

**Shared intent history**  
Optional: most frequent `intent_primary` across shared events. Label: "Usually here to: [find_cofounder]." Populated from `event_attendees` join.

### 5.2 What Does Not Change

- The `get_public_profile_brief()` RPC signature is unchanged. New data is fetched by a separate `get_connection_context(p_subject_profile_id)` RPC that returns connection status + mutual event count. Keeping them separate avoids breaking existing callers.
- Avatar, name, and skills fields are unchanged.
- The profile page layout is not designed here (architecture only).

### 5.3 New RPC: `get_connection_context`

```
get_connection_context(p_subject_profile_id uuid)
RETURNS jsonb
  -- {
  --   connection_status:     'not_connected' | 'pending_sent' |
  --                          'pending_received' | 'connected',
  --   connection_id:         uuid | null,
  --   mutual_event_count:    int,
  --   most_recent_shared_event: { id, name, starts_at } | null
  -- }
```

Requires the caller to be authenticated (uses `current_profile_id()` internally). Public profile views without auth receive a null response from this RPC and show no connection CTA.

---

## 6. Migration Plan

### 6.1 Zero-Downtime Constraint

The existing schema has active users. Migrations must not lock tables or break existing RPCs. All changes are additive.

### Step 1 — Add `connections` table

Single DDL migration. No existing table is altered. Creates the table, partial unique index, and all auxiliary indexes from §1.

**RLS policies added in the same migration:**
- SELECT: `requester_id = current_profile_id() OR addressee_id = current_profile_id()`. Users see only their own connections.
- INSERT: `requester_id = current_profile_id()`. Users can only create requests as themselves.
- UPDATE: `(addressee_id = current_profile_id() AND status = 'pending')` for accept/decline, OR `(requester_id = current_profile_id() AND status = 'pending')` for withdraw. No DELETE policy (rows are never deleted).

**Estimated impact:** Additive only. No existing queries affected.

### Step 2 — Add RPCs

Three new RPCs in a single migration file:
- `request_connection()`
- `accept_connection()`
- `decline_connection()`

Plus `get_connection_context()` for profile page.

These are CREATE OR REPLACE functions. No existing function signatures change.

### Step 3 — Patch `compute_interaction_intelligence()`

Replace the existing function with `CREATE OR REPLACE FUNCTION compute_interaction_intelligence()`. The only behavioral change is:
1. Skip pairs that are already `accepted` in `connections`.
2. Add historical shared-event bonus to score.

Existing intelligence rows are not backfilled or altered. The next time `compute_interaction_intelligence()` runs for any event, the new logic applies.

**Rollback:** Re-deploy the previous function body. No data migration required.

### Step 4 — Patch `get_my_intelligence()`

Replace with `CREATE OR REPLACE FUNCTION get_my_intelligence()`. Adds `connection_status` to the returned JSONB by left-joining `connections`. Existing callers receive the extra field and can ignore it; no breaking change.

### Step 5 — Add `get_public_event_attendees` connection status

Replace `get_public_event_attendees()` to include a `connection_status` column when the caller is authenticated. When unauthenticated (no `current_profile_id()`), the column returns `null` for all rows. Existing callers that only read `profile_id`, `name`, `avatar_url`, `intent_primary` are unaffected.

### 6.2 Migration File Sequence

```
supabase/migrations/016_connections_table.sql
  -- CREATE TABLE connections
  -- Partial unique index
  -- Auxiliary indexes
  -- RLS policies

supabase/migrations/017_connection_rpcs.sql
  -- request_connection()
  -- accept_connection()
  -- decline_connection()
  -- get_connection_context()

supabase/migrations/018_patch_intelligence_for_connections.sql
  -- CREATE OR REPLACE FUNCTION compute_interaction_intelligence()
  --   (adds suppression + historical bonus)
  -- CREATE OR REPLACE FUNCTION get_my_intelligence()
  --   (adds connection_status to output)

supabase/migrations/019_patch_public_attendees_connection_status.sql
  -- CREATE OR REPLACE FUNCTION get_public_event_attendees()
  --   (adds connection_status column)
```

### 6.3 Backfill Strategy

No backfill. The `connections` table starts empty. Existing intelligence cards will surface "Connect" CTAs for all valid pairs. As users respond, the graph grows organically.

There is no value in synthetically creating connections from historical interaction data — those interactions did not include a consent step (the "Connect" action). Synthesized edges would violate the semantic meaning of an accepted connection.

### 6.4 Rollback Plan Per Step

| Step | Rollback |
|---|---|
| 016 | `DROP TABLE connections CASCADE` — removes table and all dependent policies/indexes. No existing data affected. |
| 017 | `DROP FUNCTION` for each new RPC. No data affected. |
| 018 | Re-deploy previous `compute_interaction_intelligence()` and `get_my_intelligence()` function bodies. Intelligence rows remain; next recompute uses old logic. |
| 019 | Re-deploy previous `get_public_event_attendees()` body. |

---

## Summary: What Changes, What Doesn't

| Component | Change |
|---|---|
| `profiles` | No change |
| `events` | No change |
| `event_attendees` | No change |
| `interaction_events` | No change |
| `interaction_intelligence` | No schema change; compute function logic updated |
| `ghost_participants` | No change |
| `connections` | **New table** |
| `compute_interaction_intelligence()` | Patched: adds suppression + historical bonus |
| `get_my_intelligence()` | Patched: adds `connection_status` field to output |
| `get_public_event_attendees()` | Patched: adds `connection_status` field to output |
| `get_connection_context()` | **New RPC** |
| `request_connection()` | **New RPC** |
| `accept_connection()` | **New RPC** |
| `decline_connection()` | **New RPC** |
| `get_public_profile_brief()` | No change |

4 new migrations. 3 patched RPCs. 4 new RPCs. 1 new table.
