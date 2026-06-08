# Innovation Engine → Nearify: Concept Audit

**Date:** 2026-06-08  
**Scope:** Ontology, relationship intelligence, recommendation logic, graph concepts, themes, projects, opportunities, organizations, search, and memory systems.  
**Source A:** CharlestonHacks Innovation Engine (`index.html`, `dashboard.js`, `main.js`, `IDENTITY_CONTRACT.md`)  
**Source B:** Nearify web codebase (`/supabase/migrations/`, `/assets/js/`)  

---

## 1. Concepts Present in the Innovation Engine

### 1.1 Identity & Graph Ontology

| Concept | Description |
|---|---|
| Dual-identity contract | `auth.users.id` for ownership/RLS; `community.id` for graph nodes. Explicit written contract (`IDENTITY_CONTRACT.md`). |
| Community profile | Persistent, public-facing identity node: name, image, skills, level, XP, streak. |
| Connections | Directed, persistent edges between community nodes (`from_user_id`, `to_user_id`, `status: pending/accepted`). |
| Organizations | A first-class graph node type. Users can be members. |
| Themes | Topic circles; users join themes and projects can be associated with themes. Organizer-managed. |
| Projects | Collaborative artifacts with skill requirements, status lifecycle, theme association, and member roster. |
| Opportunities | Open requests/roles; tagged, browseable, separate entity type. |
| People (community) | The base node; drives all other relationships. |

### 1.2 Recommendation & Discovery

| Concept | Description |
|---|---|
| Suggestions engine | `suggestions/index-v2.js` + `navigation.js` — modular, versioned suggestion pipeline. |
| Daily engagement | `daily-engagement.js` — surfaces time-relevant suggestions per user. |
| Daily digest / Start flow | `start-daily-digest.js`, `start-ui-enhanced.js` — curated focus list on open. |
| "Start" modal | Contextual intent-setting on app open ("your focus today"). |
| Intent-aware suggestions | Surfaces people/projects/opps relevant to stated interests and past activity. |

### 1.3 Relationship Intelligence

| Concept | Description |
|---|---|
| Network report | `NetworkReport` — per-user analytics card: connection depth, theme distribution, XP trajectory. |
| Network stats dashboard | Counts: connected, projects, themes, opportunities. Live display. |
| Tier / tier control | `GraphController` applies visual weight/opacity to nodes by relationship tier. |
| Organizer insights | Skill and intent aggregation across attendees. |

### 1.4 Graph Visualization

| Concept | Description |
|---|---|
| Synapse graph | D3-force SVG graph of community nodes + relationship edges. |
| Graph filters | Filter chips: Connected, Projects, Themes, Opps — each narrows the rendered subgraph. |
| Filter context header | Live label showing active lens + count of visible nodes. |
| Graph legend | `graph-legend.js` — node type key. |
| Network filters | `network-filters.js` — compound filter state management. |
| Realtime collaboration | `realtime-collaboration.js` — live updates to graph state without reload. |

### 1.5 Engagement & Gamification

| Concept | Description |
|---|---|
| XP / level | Integer XP + level badge rendered in identity panel. |
| Streak | Fire icon + day count for consecutive engagement. |
| Profile completeness | Progress bar + percentage toward full profile. |
| Endorsements | Peer-to-peer skill endorsements with received/given tabs and weekly delta. |

### 1.6 Communication

| Concept | Description |
|---|---|
| Direct messaging | `messaging.js` — conversation threads between community members. |
| Unified notifications | `unified-notification-system.js` — single panel for messages, notifications, required actions. |
| Mobile notification badges | Split into three badge types: messages / notifications / actions. |
| Actions queue | Separate category for items requiring a decision (connection requests, etc.). |

### 1.7 Presence & Physical Networking

| Concept | Description |
|---|---|
| Realtime presence | `presence-realtime.js` — online/offline/idle state via Supabase Realtime. |
| Presence UI | `presence-ui.js` — dot indicators on graph nodes. |
| BLE passive networking | `ble-passive-networking.js` — passive Bluetooth proximity detection for opportunistic discovery. |

### 1.8 Search

| Concept | Description |
|---|---|
| Global search | Unified input across people, projects, themes, orgs, opportunities. |
| Enhanced search | `enhanced-search.js` — typeahead/suggestion layer on global search. |
| Category action bar | Context-aware actions rendered above search based on result category. |

### 1.9 Content & Admin

| Concept | Description |
|---|---|
| Theme admin | `theme-admin.js` — create/manage theme circles. |
| Theme discovery | `theme-discovery.js` — browse and join themes. |
| Admin analytics | `admin-analytics.js` — platform-wide usage metrics. |
| Admin people panel | `adminPeoplePanel.js` — manage community members. |
| Mentor guide | `mentor-guide.js` — onboarding mentor persona. |
| Onboarding flow | Multi-step profile completion flow, triggered when `_needsOnboarding` flag is set. |

### 1.10 Architecture & Memory

| Concept | Description |
|---|---|
| Post-auth module loader | Deferred script injection after auth gate. Keeps unauthenticated cold start lightweight. |
| Boot gate | `boot-gate.js` — event bus that coordinates startup sequencing. |
| Session restore | Visibility-change handler restores session state after tab backgrounding. |
| Single-flight guards | Per-system `__IE_*_INIT__` flags prevent duplicate initialization. |
| Quiet mode | `quiet-mode.js` + `quiet-mode-auto-disable.js` — suppresses non-critical UI. |

---

## 2. Concepts Already Present in Nearify

| Concept | Nearify Implementation |
|---|---|
| Event-scoped identity nodes | `profiles` table + `event_attendees` with intent/goals/constraints context |
| Interaction edges | `interaction_events` — proximity, QR, ghost signals with strength + dwell |
| Computed intelligence / recommendations | `interaction_intelligence` table + `compute_interaction_intelligence()` RPC + `intelligence-algo.js` scoring pipeline |
| Intent classification | `intent_primary`, `intent_secondary`, energy_level — richer per-event context than IE |
| Ghost / unauthenticated participation | `ghost_participants` table + token-based RPC access — more sophisticated than IE |
| Dual identity contract | `auth.users.id` vs `profiles.id` — same separation IE documents; applied in RLS |
| Admin access control | Client-side allowlist in `adminAccess.js` |
| Organizer analytics | `organizerInsights.js`, `funnelDashboard.js`, `externalEvents.js` |
| Funnel tracking | `analytics_events` table + `get_meetup_funnel()` RPC |
| External event ingestion | `external_events` table + matching pipeline |
| Deferred/lazy loading | Post-auth script loading pattern (same concept, less structured) |
| Session persistence (localStorage) | `appState.js`, `ghostSession.js` |
| Polling coordinator | `pollingCoordinator.js` — visibility-aware background polling |
| Physical proximity networking | iOS BLE signals feeding `interaction_events` |

---

## 3. Concepts Missing from Nearify

### 3.1 Core Graph / Social Layer
- **Persistent connections** — no `connections` table; relationships are event-scoped and ephemeral
- **Follow / persistent graph edges** — no way to track a relationship across multiple events
- **Organizations** — no org entity; no org membership
- **Themes / topic circles** — no shared topic groupings that persist across events
- **Projects** — no collaborative artifact entity
- **Opportunities** — no open role/request entity

### 3.2 Recommendations
- **Cross-event suggestions** — IE suggests people based on multi-event history; Nearify recommendations are single-event
- **Daily digest / focus flow** — no "today's focus" surface
- **Persistent suggestions pipeline** — IE's `suggestions/index-v2.js` operates across the full graph; Nearify scores only within an event context

### 3.3 Engagement & Gamification
- **XP / leveling / streaks** — absent entirely
- **Profile completeness score** — no prompt to fill out profile
- **Endorsements** — no peer skill validation

### 3.4 Communication
- **Direct messaging** — no conversation threads
- **Unified notification center** — no in-app notification panel
- **Actions queue** — pending requests are surfaced per-page, not aggregated

### 3.5 Presence
- **Realtime presence indicators** — polling only; no live dot indicators on profiles
- **Online/offline/idle state** — not tracked

### 3.6 Search
- **Global search** — no cross-entity search; discovery is event-scoped
- **Typeahead / enhanced search** — not implemented

### 3.7 Memory & Context
- **Cross-event user memory** — user's interests/goals/connections do not accumulate over time
- **Session restore on tab return** — basic; no profile re-fetch after long absence
- **Boot gate / startup sequencing** — no coordinated init bus; scripts load independently

### 3.8 Admin & Content
- **Theme management** — no topic curation tools
- **Onboarding flow** — no guided profile completion

---

## 4. Concepts Worth Adopting

These concepts from IE have clear, near-term value for Nearify's core mission (event-driven professional networking) and fit the existing data model with modest schema additions.

### Priority 1 — Foundation

**4.1 Persistent connections (cross-event relationship graph)**  
*What:* A `connections` table (`from_profile_id`, `to_profile_id`, `status`, `source_event_id`).  
*Why:* Intelligence scores are currently discarded after an event. Allowing users to "confirm" a match creates a persistent graph that makes future event recommendations stronger. Nearify's interaction_intelligence records become seeds for this.  
*Schema delta:* One new table. Nearify already has the `profiles.id` node identity it needs.

**4.2 Dual-identity contract (write it down)**  
*What:* A `IDENTITY_CONTRACT.md` equivalent documenting `auth.users.id` vs `profiles.id` — Nearify already enforces this in RLS but does not document it.  
*Why:* The IE team found this distinction caused silent bugs. Formalizing it now prevents future schema drift as Nearify adds tables.

**4.3 Boot gate / startup sequencing**  
*What:* A lightweight event bus (`AUTH_READY`, `PROFILE_LOADED`) that coordinates deferred module loading.  
*Why:* Nearify's current approach loads all scripts independently. As features grow (messaging, notifications, presence) this will cause race conditions. IE's post-auth loader pattern is proven and cleanly separates guest from authenticated code paths.

### Priority 2 — Recommendation Quality

**4.4 Cross-event scoring**  
*What:* Extend `intelligence-algo.js` to weight signal strength by recency across multiple events, not just within one.  
*Why:* A user you've interacted with at three events should rank higher than a first-time co-attendee with equal per-event signal. This is a pure algorithm change; no schema delta required if connections are stored.

**4.5 Intent persistence across events**  
*What:* Store `intent_primary` + `skills` at the profile level (not only per `event_attendees`), updatable per-event but persisted as "last known intent."  
*Why:* Enables pre-event suggestions ("people at this event who match your usual intent") and post-event matching against users who weren't at the same event.  
*Schema delta:* Two nullable columns on `profiles`.

**4.6 Profile completeness score**  
*What:* Client-side computation of what profile fields are filled in, with nudge UI.  
*Why:* Completeness directly improves recommendation quality. Low-hanging engagement improvement.

### Priority 3 — Discovery Surface

**4.7 Global search across profiles + events**  
*What:* Unified search input that queries profiles (name, skills) and events (name, description) via Supabase `ilike` or `fts`.  
*Why:* Currently there is no way to find a specific person by name or skill. This is a basic table-stakes feature for any networking product.

**4.8 Themes (lightweight)**  
*What:* A `themes` table (id, name, slug, description) + `profile_themes` junction. No admin UI required initially.  
*Why:* Allows clustering users by topic area. Enables "people at this event who share your themes" as a recommendation signal. IE uses themes as its primary discovery lens.

**4.9 Unified notification center**  
*What:* A single in-app panel aggregating connection requests, intelligence cards, and system messages.  
*Why:* Currently, pending actions are scattered. Centralizing them increases response rates and reduces missed connections.

### Priority 4 — Engagement

**4.10 Endorsements**  
*What:* `endorsements` table (`endorser_profile_id`, `endorsed_profile_id`, `skill`).  
*Why:* Endorsements create a secondary relationship signal (separate from co-event proximity) and drive profile visits and re-engagement. IE uses them effectively as a re-engagement loop.

**4.11 Streak / last-active engagement tracking**  
*What:* Track `last_event_at`, `event_count` on profiles. Surface a simple "you've connected at N events" stat.  
*Why:* Low implementation cost; provides both a personal motivation layer and a data signal for recommendation weighting (active users get better suggestions).

---

## 5. Concepts That Should Remain Experimental

These concepts have real value but carry significant implementation complexity, UX risk, or are premature given Nearify's current scale and event-centric focus.

**5.1 BLE Passive Networking (web layer)**  
IE's `ble-passive-networking.js` attempts passive Bluetooth discovery in a browser context. Web Bluetooth is unreliable across browsers and requires explicit user permission. Nearify's iOS app already handles BLE more reliably. The web layer adds complexity with minimal gain.  
*Revisit when:* Multi-platform parity requires it, or Web Bluetooth support stabilizes.

**5.2 XP / Leveling system**  
Gamification in professional networking contexts has a mixed track record. Points and levels work for consumer apps; in B2B/professional contexts they can feel juvenile or incentivize hollow engagement. Nearify's intelligence-first positioning is stronger than a badge system.  
*Revisit when:* Retention data shows a specific engagement problem that gamification would solve. Start with streaks (4.11) as a proxy.

**5.3 Direct messaging**  
In-app DMs require moderation, spam controls, mobile push infrastructure, and significant product surface. At Nearify's current stage, the right move is a strong "connect + handoff to LinkedIn/email" flow rather than building a messaging product.  
*Revisit when:* Connections are persistent (4.1) and users express demand for in-product follow-up.

**5.4 D3 graph visualization**  
IE's synapse graph is visually compelling but is a significant engineering surface for a web product (interaction handling, force simulation, mobile touch). Nearify's intelligence cards and list-based discovery serve the same functional goal more reliably.  
*Revisit when:* There is a specific use case (event "room" visualization, connection map) that cards cannot serve.

**5.5 Realtime presence indicators**  
Online/offline dots require a sustained WebSocket connection per user and add meaningful infrastructure cost. Value is high in a live-event context (Nearify's core) but marginal for background profile browsing.  
*Revisit when:* A live-event mode is built where knowing who is "active right now" meaningfully improves connection rates.

**5.6 Organizations as a first-class entity**  
IE treats orgs as full graph nodes with memberships. This is appropriate for a persistent community platform but premature for event-scoped networking. The right initial representation is a freetext `organization` field on profiles.  
*Revisit when:* Organizers want to target outreach by company or sponsor profiles are needed.

**5.7 Projects**  
Collaborative project creation and management is a full product vertical. It is one of IE's most complex subsystems (skills, members, statuses, theme associations, creation wizard). Adding it to Nearify would shift the product's center of gravity.  
*Revisit when:* Post-event "let's build this together" use cases emerge as a documented retention driver.

---

## 6. Phased Migration Strategy

### Phase 0 — Foundations (no user-facing changes)
**Goal:** Eliminate technical debt that blocks future phases.

1. Write `docs/IDENTITY_CONTRACT.md` documenting `auth.users.id` vs `profiles.id` (adapt IE's contract to Nearify's table names). *(done: this document)*
2. Implement a lightweight boot gate: an event bus that fires `AUTH_READY` and `PROFILE_LOADED`, with a post-auth deferred loader for future feature modules.
3. Add `last_intent`, `intent_updated_at`, `skills` columns to `profiles` (nullable). Populate on event join.
4. Add profile completeness computation in `navAuth.js` (client-side, no schema change).

**Success criteria:** Zero new user-facing features. Internal architecture only. All existing tests pass.

---

### Phase 1 — Persistent Graph (4-6 weeks)
**Goal:** Make relationships survive beyond a single event.

1. **Schema:** Add `connections` table (`id`, `from_profile_id`, `to_profile_id`, `status`, `source_event_id`, `created_at`). Add RLS: users can see their own connections; insert requires one side to be the authenticated profile.
2. **Product:** After intelligence cards are shown, add a "Connect" action that writes to `connections` with status `pending`. Target profile receives a notification (initially: email via Supabase trigger).
3. **Intelligence:** Extend `intelligence-algo.js` to check `connections.status` — already-connected pairs are suppressed from new recommendations.
4. **Profile page:** Show connection count and mutual event count on `profile.html`.

**Success criteria:** A user can maintain a connection roster. Event intelligence cards reference existing connection state.

---

### Phase 2 — Discovery & Search (3-4 weeks)
**Goal:** Enable users to find people outside of event context.

1. **Global search:** Add unified search over `profiles` (name, skills) and `events` (name). Supabase `ilike` on indexed columns is sufficient for initial scale.
2. **Themes (lightweight):** Add `themes` table + `profile_themes` junction. Seed with 10-15 canonical topics. Allow users to select themes on profile. No admin UI yet.
3. **Cross-event suggestions:** On the home page, show "People in your network you haven't connected with yet" — `connections` + `interaction_intelligence` join.
4. **Notification center:** Aggregate pending connection requests into a single accessible panel (badge count in nav, modal with accept/decline).

**Success criteria:** A user with no upcoming events can still find and connect with people. Connection request response rate measurable.

---

### Phase 3 — Signal Enrichment (4-6 weeks)
**Goal:** Improve recommendation quality with richer persistent signals.

1. **Endorsements:** Add `endorsements` table. Surface on profile pages. Use endorsement count as a signal weight in cross-event scoring.
2. **Event series / cohorts:** Add `event_series_id` FK on `events` table. Group recurring events. Use series membership as a strong co-interest signal.
3. **Streak / engagement tracking:** Add `event_count`, `last_event_at` to `profiles`. Surface "N events attended" stat. Use as recency weight in suggestions.
4. **Intent persistence refinement:** After 3+ events, compute a user's "dominant intent" from `event_attendees.intent_primary` history. Display as a profile attribute.

**Success criteria:** Recommendation precision improves (measure via connection rate per suggested pair). Returning users see more relevant pre-event suggestions.

---

### Phase 4 — Presence & Live Experience (Future)
**Goal:** Enhance the real-time event experience.

1. **Realtime presence** (Supabase Realtime channels): Show who is actively viewing an event page. Low infrastructure cost; scoped to event context only.
2. **Live suggestions during events:** Trigger push notifications to iOS when a high-score match is detected at the same event (requires iOS push infra).
3. **Organizations (lightweight):** Add `organization` freetext to profiles. Add `org_domain` for automatic company clustering. No full org entity yet.

---

### Concepts Explicitly Deferred (do not roadmap yet)
- D3 graph visualization
- Direct messaging
- XP / gamification
- Projects as a collaborative entity
- Organizations as full graph nodes
- BLE passive networking (web)
- Admin analytics platform

---

## Appendix: Schema Delta Summary

| Phase | New Tables | Modified Tables |
|---|---|---|
| 0 | — | `profiles` (+last_intent, +intent_updated_at, +skills) |
| 1 | `connections` | — |
| 2 | `themes`, `profile_themes` | — |
| 3 | `endorsements` | `profiles` (+event_count, +last_event_at), `events` (+event_series_id) |
| 4 | — | TBD |

## Appendix: Identity Contract (Nearify)

| Column | Meaning | Use for |
|---|---|---|
| `auth.users.id` | Supabase session identity | RLS checks, ownership checks, audit |
| `profiles.id` | Public graph identity | All relationship edges, event_attendees, interaction_events, connections |
| `profiles.user_id` | FK from profiles → auth | Resolving `auth.uid()` → `profiles.id` via `current_profile_id()` |
| `ghost_participants.id` | Ephemeral node identity | Ghost interaction edges only |

> **Rule:** Never use `auth.users.id` in a join with graph relationship tables. Always resolve to `profiles.id` first via `current_profile_id()`.
