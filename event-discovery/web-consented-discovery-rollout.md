# Web consented attendee discovery — rollout review

This PR changes `assets/js/eventDetail.js` only. It does **not** deploy Supabase migrations or close the existing database access vulnerabilities.

## Behavior
- Event Detail no longer reads the unfiltered event roster via `event_attendees` plus `profiles` for discovery.
- The roster is loaded through `get_consented_event_attendees` only for a signed-in current attendee.
- Own-profile and own-attendance lookups are retained to determine membership even if the caller has not opted into discovery.
- The event-specific checkbox reads `get_my_event_discovery_preference` and writes the caller's preference through `event_discovery_preferences` with RLS ownership checks.
- The opt-in copy covers name, photo, interests, skills and event goals.
- Guest and non-attendee views do not fetch or render attendee cards.
- Connection matching and event-reason suggestions only use the opted-in roster.
- Momentum UI currently receives the **opted-in** roster; verify its copy never implies a complete attendee count.

## Required prerequisites
1. Validate/apply the consent foundation and consented roster RPC in staging. A GitHub merge is not a DB migration.
2. Confirm attendance status values (`joined`, `inEvent`), preference RLS and `profiles` mapping.
3. Test the new RPC response shape and JS compatibility with actual staging data.
4. Verify the consent preference UPDATE/UPSERT policy works for both first opt-in and withdrawal. If `upsert` requires extra SELECT visibility, test it explicitly.
5. Ensure consent can be withdrawn after leaving an event through an account-level control or explicit backend cleanup. Current Event Detail hides the checkbox for non-attendees and past events; **this is an outstanding UX/privacy gap**.
6. Verify event joining refreshes discovery state, and sign-out clears roster cards.
7. Verify past-event discovery requirements. The current RPC permits only active attendance and may not return historical attendees.

## Security tests
- Guest: no roster RPC request, no attendee names.
- Signed-in non-attendee: no roster RPC request, no attendee names.
- Signed-in attendee, default consent false: can see opted-in peers, not self-listed.
- Signed-in attendee, consent true: other current attendees can see their allowed fields.
- Withdrawal: caller disappears from new RPC results immediately.
- Event A member cannot read event B roster.
- Direct PostgREST table reads and legacy `get_public_event_attendees`: **still vulnerable until final DB lockdown**.
- Existing join, presence, event goals, organizer insights, and iOS compatibility must be regression-tested.

## Not included
- Organizer insights still uses direct table reads.
- Existing anonymous roster RPC and broad SELECT policies are unchanged.
- No production migration, SQL execution, backup, or deployment.
- No claim that full end-to-end tests have run.

**Do not deploy this web change before the new RPC and consent schema are verified in staging.**
