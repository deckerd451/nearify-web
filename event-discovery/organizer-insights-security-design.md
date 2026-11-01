# Organizer Insights: security implementation gate

**Design and review only.** Organizer Insights still reads `event_attendees` and `profiles` directly in `assets/js/organizerInsights.js`. The upstream `canManageEvent()` UI check is not a database authorization boundary.

## Required server contract

Build a SECURITY DEFINER `get_organizer_event_insights(p_event_id uuid)` function **only after confirming the production organizer authorization model**. It must:
- Require `auth.uid()` and verify that the caller manages this exact event using the same authoritative event ownership/membership data as server-side event management. Never trust a client-supplied organizer ID or a browser-only `canManageEvent()` result.
- Return aggregate counts and grouped tags/goals only, never attendee identifiers, names, emails, phone numbers, individual goals or raw rows.
- Consider a minimum reporting threshold and suppression of rare groups to prevent re-identification, especially for small events.
- Define whether opted-out attendee records may contribute to organizer aggregates and disclose that policy to users.
- Limit output size and guard cross-event queries. Use an empty search_path and fully qualified relations.
- Grant EXECUTE only to `authenticated` after reviewing function ownership, and verify anonymous access is denied.
- Replace the direct table reads in `organizerInsights.js` with this endpoint before tightening RLS.

## Staging verification
- Anonymous, signed-in non-organizer, organizer of another event, and former organizer are denied.
- Authorized organizer receives only permitted aggregate values.
- Small cohorts and unique tags do not expose identifying details.
- Guest event page and non-organizer event page do not fetch organizer insights.
- iOS event joining, attendance heartbeat, and event context continue working.
- Verify real event ownership schema and RPC signature before writing SQL. No guessed authorization predicate should reach production.

## Discovery withdrawal behavior

The event page now displays an explicit **Withdraw discovery consent** action for a signed-in former attendee whose own stored preference remains enabled. It deletes only their own preference row, relying on the existing own-row DELETE RLS policy. A former attendee cannot enable discovery. Verify in staging that the RPC returns true for former attendees and that DELETE is permitted after leave.

The current consented roster RPC already filters for active attendees, so leaving excludes the person from discovery even before withdrawal. The withdrawal action additionally clears the saved preference.

## Remaining release blockers

The original anonymous `get_public_event_attendees` endpoint and broad `event_attendees` / `profiles` SELECT policies remain unsafe. The web change alone does not resolve them. Do not apply restrictive RLS or revoke legacy RPC access until all web/iOS consumers have been migrated, verified with actual JWTs, and a backup/recovery plan has been tested.
