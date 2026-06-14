# Upcoming Events With Your Connections — Audit

_Date: 2026-06-14_

## Goal

Allow authenticated users to discover future opportunities to reconnect with people already in their network, without adding messaging, notifications, feeds, or new relationship tables.

## Architecture map

### Existing data sources

| Data source | Current role | Relevant fields / behavior | Reuse fit |
| --- | --- | --- | --- |
| `get_my_connections(p_status text)` | Returns the caller's current network from formal `relationships` plus claimed guest interactions. | Returns one row per connected person with `profile_id`, `name`, `avatar_url`, `encounter_count`, encounter timestamps, `first_encounter_event_name`, and `source_event_id`. | Best source for “people in my network.” |
| `relationships` | Persistent undirected profile-pair graph. | Canonical pair columns `profile_a_id`/`profile_b_id`; `status` is `proposed` or `confirmed`; one row per pair. | Already powers confirmed connections through `get_my_connections`; no new table needed. |
| `event_attendees` | Event membership and per-event intent context. | Joins `event_id` to `profile_id`; existing code already queries attendee profile IDs by event. | Best source for “is this connection attending this event?” |
| `events` | Event metadata and schedule. | Existing UI uses `starts_at` to split upcoming vs. past events. | Best source for “upcoming event name/date/link.” |
| `profiles` | Public identity node. | `get_my_connections` and `get_public_event_attendees` already join profiles for `name` and `avatar_url`. | No direct extra profile query needed for the smallest UX if `get_my_connections` is reused. |

### Existing RPCs and queries to reuse

1. `get_my_connections('confirmed')` is already called by:
   - `assets/js/connections.js` for the My Connections page.
   - `assets/js/eventDetail.js` for “People You Know” on a specific event page.
   - `assets/js/dashboard.js` for the dashboard network-memory widget.
2. `eventDetail.js` already contains the key client-side matching pattern:
   - fetch current event attendees,
   - call `get_my_connections('confirmed')`,
   - intersect attendee profile IDs with connection profile IDs.
3. `get_public_event_attendees(p_event_id)` can identify attendees for a single event and already returns `relationship_status`, but it is less efficient for a multi-event homepage widget because it requires one RPC per event.
4. Direct Supabase queries against `events` and `event_attendees` are already used elsewhere and are sufficient for a smallest implementation.

## Can the system already answer the question?

Yes, with existing primitives, the system can answer:

> Which upcoming events are attended by people in my network?

The answer requires joining three existing concepts:

1. Current user's confirmed network from `get_my_connections('confirmed')`.
2. Upcoming events from `events` where `starts_at >= now()` and `deleted_at IS NULL`.
3. Attendance rows from `event_attendees` where `profile_id IN connectionProfileIds` and `event_id IN upcomingEventIds`.

No schema change is required. No new relationship table is required.

## Smallest query plan

### Client-side composition, no new RPC

This is the lowest-risk implementation because it reuses deployed tables/RPCs and mirrors existing client patterns.

1. Require an authenticated session. If unauthenticated, do not show the personalized widget.
2. Fetch confirmed connections:

```js
const { data: connections } = await supabase.rpc("get_my_connections", { p_status: "confirmed" });
```

3. Extract connection profile IDs:

```js
const connectionIds = connections.map((c) => c.profile_id).filter(Boolean);
```

4. Fetch a limited upcoming event set:

```js
const { data: upcomingEvents } = await supabase
  .from("events")
  .select("id, name, slug, location, starts_at, ends_at")
  .is("deleted_at", null)
  .gte("starts_at", new Date().toISOString())
  .order("starts_at", { ascending: true })
  .limit(25);
```

5. Fetch matching attendance rows in one query:

```js
const { data: rows } = await supabase
  .from("event_attendees")
  .select("event_id, profile_id")
  .in("event_id", upcomingEvents.map((e) => e.id))
  .in("profile_id", connectionIds);
```

6. Join in memory:
   - `eventsById[event_id]` for event metadata.
   - `connectionsByProfileId[profile_id]` for person name/avatar.
   - Sort by event `starts_at` ascending, then connection recency/encounter count if desired.
   - Limit to 3–5 cards.

### Optional later RPC

If performance or RLS policy complexity becomes a concern, add one read-only RPC such as `get_upcoming_events_with_my_connections(limit int default 5)`. That is not needed for the smallest implementation and should be deferred until the client composition proves insufficient.

## UX recommendation

### Option A — Homepage widget

**Recommended.** Add a small authenticated-only widget below or near the existing upcoming-events section:

**Upcoming opportunities to reconnect**

- Doug Hamilton — CharlestonHacks Happy Hour
- Alex Chen — HarborHack

Why this is lowest-complexity:

- The homepage already loads public upcoming events and has the right discovery context.
- The widget is additive and can be hidden when no matches exist.
- It does not alter the mental model of My Connections.
- It creates a natural click path to the event detail page, not to messaging or notifications.

Suggested card behavior:

- Primary text: connection name.
- Secondary text: event name.
- Optional tertiary text: date/time.
- Link target: event detail page.
- Empty state: hide the widget entirely.

### Option B — My Connections enhancement

Lower priority. It is a good follow-up once Option A is validated:

- Add “Upcoming together” metadata under each connection row.
- This requires either per-connection lookups or a page-wide attendance/event query and more nuanced row rendering.
- It is useful for deliberate network review, but less discoverable than homepage placement.

## Lowest-complexity implementation recommendation

Implement **Option A: Homepage widget** using **client-side composition** and no schema changes.

Minimal file scope:

1. `assets/js/home.js`
   - Add `fetchUpcomingConnectionOpportunities()`.
   - Reuse `getCurrentUser()` / authenticated session gate.
   - Call `get_my_connections('confirmed')`.
   - Query upcoming `events` and matching `event_attendees` once each.
   - Render/hide a compact widget.
2. Homepage HTML/CSS file(s)
   - Add a small container for the widget or render it entirely from JS into an existing area if suitable.

Guardrails:

- Do not add messaging.
- Do not add notifications.
- Do not add feeds.
- Do not add new relationship tables.
- Avoid polling this widget independently; load on page init, or refresh only when the existing homepage events refreshes.

## Implementation estimate

| Work item | Estimate |
| --- | ---: |
| Add homepage markup/container | 15–30 min |
| Add query helper and in-memory join in `home.js` | 45–75 min |
| Render responsive compact cards | 30–60 min |
| Empty/error/auth states | 15–30 min |
| Manual smoke test | 30 min |
| Total | 2–3.5 hours |

## Risks / open checks

1. Confirm `event_attendees` SELECT policies allow an authenticated user to query attendance for upcoming public events. Existing client code already reads `event_attendees`, so this is likely okay.
2. Confirm homepage event query should include only active/public events. Existing homepage behavior should be mirrored rather than inventing a new visibility rule.
3. If `starts_at` can be null, decide whether null-start events belong in “upcoming.” Existing homepage treats missing `starts_at` as upcoming; the personalized widget should probably follow that behavior or explicitly exclude them for clarity.
