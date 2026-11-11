# Legacy attendee roster: anonymous access remediation gate

**Status: candidate migration only; NOT applied to Supabase.** Follows issue #316 and audit PR #317.

## Confirmed finding

The production function definition shared by the project owner permits unauthenticated calls to `get_public_event_attendees(uuid)` and returns `profile_id`, `name` and `intent_primary` without checking event discovery consent. Hiding `avatar_url` does not make the result anonymous. The SQL source comment about being reached only from a guest join page is not an API authorization boundary.

## Existing work, no duplicate directory

- Web `assets/js/eventDetail.js` uses `get_event_connection_people` only after signed-in co-attendee gating; it does **not** call the legacy roster RPC.
- Web `assets/js/join.js` uses guest session and QR endpoints; no direct call to the legacy roster RPC was found in that file.
- Migration `031_coattendee_gate_public_attendees.sql` explicitly preserved anonymous access, assuming guest room compatibility.
- `002-owner-only-select-cutover.sql` already contains a **broader** policy and RPC lockdown candidate. Do **not** apply 002 alongside 017 without reconciling both; 017 is intentionally narrower.
- iOS `EventAttendeesService.fetchAttendees` is described in migration 031 as a consumer of the legacy roster. The current iOS source and deployed versions must be checked; this PR does **not** assert they have migrated.

## Release sequence

1. Review web and **current + supported iOS builds** for direct calls to `get_public_event_attendees`, direct `profiles`/`event_attendees` SELECTs and any guest-room roster display. A web-only source scan cannot establish mobile compatibility.
2. Run `017-legacy-roster-verify.sql` read-only in staging; capture permissions and overloads.
3. Using real anon API credentials in staging, confirm a known event UUID currently returns roster identities; preserve evidence privately, not in public GitHub logs.
4. Test a staged application of `017-legacy-roster-anon-revoke.sql`. Verify anon RPC is **denied**, not merely returning an empty list. Verify authenticated legacy behavior is unchanged, while recognizing it still bypasses consent.
5. Verify two separate guest browsers can join the same event, display QR, scan, save and retrieve their own history. Test guest-to-account claim and signed-in co-attendee discovery. Verify actual iOS join/attendee screens and supported installed versions.
6. If staging passes, obtain explicit production change approval and recovery readiness. Apply 017 manually in production; rerun verify and API/device checks immediately.
7. If a critical guest regression is confirmed, `017-legacy-roster-anon-rollback.sql` can restore the **previously observed** anonymous grant, but doing so reopens the exposure. Coordinate a safer fix.

## Non-goals and remaining exposure

- No automatic database execution, UI change, new guest roster or guest-visible consent.
- Does not revoke authenticated access to the legacy RPC. That RPC still lacks explicit discovery-consent filtering and may expose opted-out attendees to signed-in co-attendees. Address after iOS consumers are migrated.
- Does not fix possible broad table SELECT policies or other SECURITY DEFINER functions. Continue the existing `final-lockdown-preflight.sql` and `002-owner-only-select-cutover.sql` review separately.
- Does not prove that all supported clients are compatible or that production access is closed.

**Do not merge a SQL file and interpret that as a deployed security fix.**
