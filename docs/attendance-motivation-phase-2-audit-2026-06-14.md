# Attendance Motivation Phase 2 Audit

Date: 2026-06-14

## Scope

This is an audit-only recommendation for ranking relationship-based attendance reasons on event cards. It does not propose new tables, notifications, feeds, AI summaries, or new infrastructure.

## 1. Relationship-strength signal inventory

### `get_my_connections(p_status)`

Best current source for the event-card feature because it already returns the user's known people and can be joined client-side against upcoming `event_attendees` rows.

Available fields:

- `relationship_id`
- `status` / `relationship_label`: `confirmed`, `proposed_by_me`, `proposed_by_them`, `ghost_claimed`
- `profile_id`, `name`, `avatar_url`
- `encounter_count`
- `first_encounter_at`
- `last_encounter_at`
- `confirmed_at`
- `first_encounter_event_name`
- `source_event_id`
- `created_at`

Important behavior:

- Formal relationships come from `relationships`.
- Claimed guest interactions are included as `ghost_claimed` when they do not already have a formal relationship row.
- Results are currently ordered by `last_encounter_at DESC NULLS LAST, created_at DESC`.

### `get_relationship_context(p_other_profile_id)`

Best source for a profile/person detail view and a good reference for how relationship memory is computed. It is too expensive for event-card batch ranking if called once per attendee.

Available fields:

- `relationship_status`
- `relationship_id`
- `first_encounter_at`
- `first_encounter_event_name`
- `last_encounter_at`
- `last_encounter_event_name`
- `encounter_count`
- `shared_intent`

Important behavior:

- Computes co-attendance history from `event_attendees` even when no formal relationship row exists.
- Computes the most frequent shared intent from the caller's `event_attendees.intent_primary` across shared events.
- Falls back to `interaction_events` for claimed ghost interactions.
- For confirmed formal relationships, it trusts relationship health columns where they are stronger than computed co-attendance.

### `relationships`

Canonical persistent relationship memory. Available strength signals:

- Lifecycle: `status`, `proposed_by_id`, `confirmed_at`.
- Provenance: `source_event_id`, `source_intelligence_id`.
- History: `first_encounter_at`, `last_encounter_at`, `encounter_count`.
- Dormancy / suppression hint: `snoozed_by_a`, `snoozed_by_b`.

This is the cleanest source for confirmed-network strength. It intentionally does not store a materialized relationship-strength score.

### `interaction_events`

Raw encounter signal source from iOS and guest flows. Available strength signals:

- `interaction_type`: originally `proximity` and `qr_confirmed`; later migrations include ghost paths such as `ghost_connect` in RPC logic.
- `strength`
- `dwell_seconds`
- `signal_strength`
- `created_at`
- `event_id`
- directional profile IDs and ghost IDs.

These are useful for computing interaction strength and recency, but should not be queried directly for every event card unless an RPC already returns the needed aggregate.

### `event_attendees`

Event membership and event-intent context. Available signals:

- Co-attendance / repeated event overlap via `(event_id, profile_id)`.
- Current-event attendance for candidate people.
- `intent_primary`, `intent_secondary`.
- `goals`, `constraints`, `energy_level`.
- `updated_at`.

Current event cards already query `event_attendees` for attendee counts, attendee profile IDs, and intent momentum.

### EL / interaction-intelligence outputs

Existing intelligence scoring contributes a useful model for future ranking, especially on event-detail surfaces:

- `score`
- `reason`
- `type`: `recommended`, `missed`, `follow_up`, plus `re_engaged` in later relationship patches.
- `direction`
- `my_intent`, `their_intent`
- `dwell_seconds`
- `encounter_count`
- `relationship_status`
- `first_encounter_event_name`

Current scoring inputs:

- Dwell time: up to 40 points.
- QR confirmation: 30 points.
- Intent alignment: 30 points.
- Historical shared events: up to 20 points.

## 2. Recommended RelationshipStrength model

Use a 0-100 derived score internally, plus three labels for copy and debugging.

```ts
type RelationshipStrengthLevel = "strong" | "medium" | "weak";

type RelationshipStrength = {
  score: number; // 0-100
  level: RelationshipStrengthLevel;
  drivers: string[];
};
```

Recommended score using existing fields only:

| Component | Max | Existing fields | Rationale |
| --- | ---: | --- | --- |
| Encounter depth | 45 | `encounter_count` | Strongest simple proxy for relationship memory. Cap quickly so 12 encounters beats 7, but 50 does not dominate forever. Suggested: `min(encounter_count, 9) * 5`. |
| Recency | 25 | `last_encounter_at` | Recent relationships are more likely to affect attendance. Suggested: 25 for <=30 days, 18 for <=90 days, 10 for <=180 days, 4 for older, 0 unknown. |
| Confirmation | 20 | `status`, `relationship_label`, `confirmed_at`, `ghost_claimed` | Confirmed should outrank merely inferred/claimed ties. Suggested: confirmed 20, ghost_claimed 12, proposed 8, unknown 0. |
| Shared intent / goal | 10 | `shared_intent`; current-event `intent_primary` / `intent_secondary`; `goals` if already fetched | Useful but should not beat repeated history. Suggested: +10 when known shared intent or current event intent overlap exists. |

Labels:

- `strong`: score >= 70, or confirmed with `encounter_count >= 5` and recent within 180 days.
- `medium`: score >= 40, or confirmed/ghost-claimed with `encounter_count >= 2`.
- `weak`: score > 0.

For the current event-card implementation, the first version can be even simpler: sort known attendees by `encounter_count DESC`, then `last_encounter_at DESC`, then confirmed before ghost/proposed. That alone fixes the “met once equals met 12 times” problem.

## 3. AttendanceReason ranking model

### Primary attendee selection

For an event with Doug (12 encounters), Alex (1), and Sarah (7), show Doug first because he has the highest relationship strength. If Sarah has much more recent encounters and Doug is stale, recency can close the gap, but encounter depth should usually win.

Recommended sort:

1. `RelationshipStrength.score DESC`.
2. `encounter_count DESC`.
3. `last_encounter_at DESC NULLS LAST`.
4. `confirmed` > `ghost_claimed` > `proposed`.
5. Stable name/profile ID fallback.

### When to show a named person

Show a named person when:

- There is exactly one known attendee; or
- There are multiple known attendees and the top attendee is clearly stronger than the rest; or
- There is one strong attendee plus weak/medium others.

Suggested dominance rule:

- `top.score >= 70` and `top.score - second.score >= 15`: show top person.
- `top.level === "strong"` and no other strong attendees: show top person.

### When to switch to people-count copy

Show people-count copy when:

- There are 2+ known attendees with similar strength; or
- There are 2+ strong attendees; or
- No one attendee clearly dominates; or
- The best known attendee is weak and the count is more persuasive than the individual name.

Suggested rules:

- `strongCount >= 2`: `N people you know are attending.`
- `knownCount >= 3` and top is medium/weak: `N people you know are attending.`
- `second.score >= top.score - 14`: `N people you know are attending.`

### When to show multiple names

On compact event cards, avoid long comma-separated names. If space allows in future APIs/cards:

- For exactly 2 known attendees and both are strong/medium: `Doug and Sarah will be there.`
- For 3+ with 2 named strong people: `Doug, Sarah, and 1 other person you know will be there.`

For web card P1, keep to one line: primary person or count.

## 4. Card-copy evaluation

Ranked by expected attendance influence:

1. `Reconnect with Doug Hamilton.` — strongest action framing; implies value to the viewer, not just a fact.
2. `Doug Hamilton will be there.` — clear, human, future-tense, lower friction than “is attending.”
3. `Doug Hamilton is attending.` — current copy; clear but more database-like.
4. `3 people you know are attending.` — strong when multiple peers attend, but less emotionally specific than a strong named person.
5. `You've met Doug 12 times.` — credible but awkward/private-feeling on a public-ish card; better as a secondary/debug detail, not primary copy.
6. `Someone you know is attending.` — too vague; use only when the name is missing or privacy requires anonymity.

Recommended default copy:

- Strong named attendee: `Reconnect with Doug Hamilton.`
- Medium named attendee: `Doug Hamilton will be there.`
- Weak single attendee: `Someone you know is attending.` or `Alex Morgan will be there.` depending privacy/product comfort.
- Multiple known attendees: `3 people you know are attending.`
- Two strong named attendees where layout permits: `Doug and Sarah will be there.`

## 5. Canonical cross-platform AttendanceReason contract

Use a derived object. Do not persist it in a new table.

```ts
type AttendanceReasonType = "person" | "people" | "relationship" | "opportunity";

type AttendanceReason = {
  type: AttendanceReasonType;
  reason: string;
  rank: number;
  strength?: {
    score: number;
    level: "strong" | "medium" | "weak";
    drivers: string[];
  };

  // type === "person"
  personId?: string;
  personName?: string;
  avatarUrl?: string | null;

  // type === "people"
  count?: number;
  peoplePreview?: Array<{
    personId: string;
    personName: string;
    avatarUrl?: string | null;
    strengthScore?: number;
  }>;

  // type === "relationship"
  relationshipStatus?: "confirmed" | "proposed_by_me" | "proposed_by_them" | "ghost_claimed" | null;
  encounterCount?: number;
  firstEncounterAt?: string | null;
  lastEncounterAt?: string | null;
  sharedIntent?: string | null;

  // type === "opportunity"
  opportunityKind?: "reconnect" | "meet_people" | "shared_goal";
};
```

Examples:

```json
{
  "type": "person",
  "personId": "...",
  "personName": "Doug Hamilton",
  "reason": "Reconnect with Doug Hamilton.",
  "rank": 1,
  "strength": { "score": 88, "level": "strong", "drivers": ["12 encounters", "confirmed", "recent"] },
  "relationshipStatus": "confirmed",
  "encounterCount": 12
}
```

```json
{
  "type": "people",
  "count": 3,
  "reason": "3 people you know are attending.",
  "rank": 1,
  "peoplePreview": [
    { "personId": "...", "personName": "Doug Hamilton", "strengthScore": 88 },
    { "personId": "...", "personName": "Sarah Lee", "strengthScore": 76 }
  ]
}
```

```json
{
  "type": "opportunity",
  "reason": "Meet people interested in fundraising.",
  "rank": 3,
  "opportunityKind": "shared_goal"
}
```

## 6. Highest-leverage event-card examples

Recommended exact copy:

| Scenario | Known attendees | Card copy |
| --- | --- | --- |
| No known attendees | 0 | Existing momentum fallback, e.g. `18 attending` plus intent flavor if available. |
| One weak connection | Alex, 1 encounter, stale or unconfirmed | `Alex Morgan will be there.` If privacy/conservatism is preferred: `Someone you know is attending.` |
| One strong connection | Doug, 12 encounters, confirmed/recent | `Reconnect with Doug Hamilton.` |
| Multiple strong connections | Doug 12, Sarah 7, Priya 6 | `3 people you know are attending.` |
| One strong plus weak others | Doug 12, Alex 1, Mia 1 | `Reconnect with Doug Hamilton.` |
| Two medium/strong and layout permits | Doug 12, Sarah 7 | `Doug and Sarah will be there.` Otherwise: `2 people you know are attending.` |

Highest-leverage card is “one strong connection” because it converts an abstract event into a concrete social opportunity with minimal copy and no new infrastructure.

## 7. Prioritized roadmap

### P1 — Rank existing known attendees before choosing card copy

Minimal code, highest attendance impact.

- Reuse current `get_my_connections('confirmed')` and `event_attendees` batch query.
- Replace arbitrary/attendance-row ordering with derived strength sorting.
- For a single dominant strong person, render `Reconnect with {Name}.`
- For multiple strong/similar people, render `{N} people you know are attending.`

No new tables. No new RPC required.

### P2 — Return structured `AttendanceReason` instead of only strings

- Keep web rendering simple, but derive a canonical object usable by web, iOS, and future APIs.
- Include `rank`, `type`, `strength`, `personId/personName`, `count`, and relationship metadata.
- Enables consistent behavior across platforms without changing storage.

### P3 — Use richer existing signals where already available

- Add shared-intent/current-event intent overlap as a small tie-breaker.
- Incorporate `ghost_claimed` more explicitly: useful but below confirmed relationships.
- Consider event-detail or API surfaces that can use EL outputs (`score`, `dwell_seconds`, `type`, `relationship_status`) when already fetched.
- Avoid direct per-card calls to `get_relationship_context` unless batching exists later.

## Decision summary

Treat attendees differently. Rank by relationship memory first, not by attendee row order. The P1 rule can be simple: strongest known attendee wins unless multiple similarly strong people make the count more persuasive.
