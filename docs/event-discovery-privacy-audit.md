# Event attendee discovery: privacy audit and release gate

Status: **review required — not an approval of current behavior or a claim of legal compliance**.

Scope: static source-code review of `assets/js/eventDetail.js`, `assets/js/attendanceReasons.js`, `events/event.html`, `community-signal/migration.sql`, and `privacy.html` on main (2026-11-01). No live Supabase policy inspection, network testing, iOS audit, or legal review has been performed.

## Current behavior observed

1. `fetchEventAttendees(eventId)` selects `profile_id, intent_primary, intent_secondary` from `event_attendees`, then queries `profiles` for `id, name, avatar_url, interests, skills` for the returned profile IDs. **No explicit event-networking consent filter is present in this client query.**
2. `renderAttendeeDiscovery` gates attendee cards in the UI to a signed-in co-attendee (`isFullAccess`). However, `loadAttendeeDiscovery` fetches the attendee data *before* determining whether the viewer is a co-attendee. UI gating does not establish server-side protection. Confirm actual RLS behavior and anonymous/authenticated network responses before release.
3. `buildAttendeeCard` shows the other attendee's `intent_primary` as `Goal: ...` and up to three interests or skills to co-attendees. Selecting an event goal currently does not provide a separate, explicit agreement to publish it to other attendees.
4. `buildEventDecisionReasons` uses attendee goals for overlap reasoning. The privacy consequences of aggregate explanations, especially at very small event sizes, need review.
5. `buildAttendeeSaveControl` requires a deliberate tap; the existing connection workflow should remain manual, with no automatic messaging or saves.
6. Organizer tools are client-hidden pending `canManageEvent`; this does **not** establish that organizer insights are server-restricted. Audit `organizerInsights.js` and the underlying RPC/RLS permissions separately.
7. `privacy.html` describes profile visibility and connection suggestions in broad terms but does not clearly explain event-specific discoverability, goal sharing, withdrawal, or audience scope.
8. Community Signal has its own opt-in preferences and RPC. **Do not equate Community Signal opt-in with event-specific discovery consent** without an explicit product decision and updated notice.

## Required decisions before broadening People to Meet

- **Separate participation from discovery:** attending an event must not automatically opt someone into recommendation cards. Choose an explicit, initially-off event discovery preference and a clear explanation of who can see the profile.
- **Separate goals from publication:** the event goal may be used privately for personal planning; displaying it to others requires its own clear disclosure or consent. Avoid showing exact goals until the product decision and enforcement are in place.
- **Limit profile fields:** define the minimal visible fields and whether interests/skills are intentionally shared; do not assume profile fields are public because they are queryable.
- **Withdrawability:** specify how a member opts out and what happens to prior connections, event participation, and historical event pages.
- **Audience:** decide whether only verified co-attendees may see discovery, whether past events continue to expose rosters, and whether organizers have any additional person-level access.
- **Safety:** block/self-exclusion behavior and abuse reporting should be assessed before widening discovery.

## Database / security acceptance criteria

- Inspect `event_attendees`, `profiles`, and organizer insight RPC/table grants and RLS policies in **production** with read-only SQL or the Supabase dashboard. Capture the actual effective policies for anon, authenticated non-attendee, attendee, and organizer.
- Verify unauthorized clients cannot retrieve profile IDs, goals, or interest arrays through direct REST queries or RPCs, even when the UI hides cards. Include past-event access and cross-event access.
- Implement consent enforcement **server-side** in a narrowly scoped RPC or equivalent RLS-safe design; never rely solely on a JS filter. Define authorization and withdrawal semantics before writing a migration.
- Review indexes, query limits, and the possibility of inferring individuals from small aggregate counts.
- Review and update privacy notice and in-product consent copy *before enabling* new discovery. Obtain applicable legal review if needed.
- Because the production database has no managed backups, require a reviewed, reversible migration and a tested recovery plan; do not apply SQL as part of this audit PR.

## Recommended phased implementation

**Phase A (this PR):** document current behavior and risks. No changes to visibility, SQL, or production permissions.

**Phase B:** design consent and access-control schema, review production policies, write read-only verification tests, and agree on the member-facing notice.

**Phase C:** implement server-enforced opt-in discovery and minimal fields; verify anonymous, non-attendee, opted-out, attendee, and organizer cases.

**Phase D:** only then introduce relevance ranking and explanations based on fields users intentionally share.

## Manual validation matrix

| Viewer | Expected eventual discovery behavior |
| --- | --- |
| Anonymous | No identifiable attendee roster or private goals |
| Signed-in non-attendee | No identifiable attendee roster or private goals |
| Co-attendee, not opted in | Can attend, but is not discoverable; sees only information the policy permits |
| Co-attendee, opted in | Visible to authorized co-attendees with minimal agreed fields |
| Opted-out attendee | Removed from discovery; attendance remains intact |
| Organizer | Aggregate insights only unless additional person-level access is explicitly justified and enforced |
| Past-event visitor | No newly exposed historical roster without the same consent and authorization rules |

**Audit limitation:** the above identifies risks in source code, not proof of a production data breach. Actual exposure depends on server-side policies that still need verification.
