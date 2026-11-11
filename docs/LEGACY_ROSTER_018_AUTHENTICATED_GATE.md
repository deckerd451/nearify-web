# Legacy roster: authenticated consent bypass — production gate

**Candidate only; no production execution.** Current project has a small tester population, which simplifies coordination but does not reduce the importance of consent or replace a recovery plan.

## Confirmed exposure

The production definition of `get_public_event_attendees(uuid)` checks co-attendance for authenticated users but returns all matching `event_attendees` profiles, without checking event discovery preferences. Thus it may disclose opted-out co-attendees. The anonymous EXECUTE grant was revoked manually in production and verified false; authenticated remained true. This does not establish that direct table RLS is safe.

## Compatibility findings

- Current web event page uses `get_event_connection_people` and signed-in event gating; guest QR uses separate guest endpoints.
- Current canonical iOS `EventAttendeesService` reads `event_attendees` and `profiles` directly, not this legacy RPC. iOS People at this event consented discovery was successfully exercised on a tester iPhone after the anonymous revoke.
- Repository GitHub code search was unavailable/unindexed; **no complete source-wide or historical shipped-build inventory has been established**. Check supported iOS builds and any other clients before applying.
- Do **not** apply the broader owner-only table SELECT cutover (002) with this change: direct iOS attendee reads may break.

## Read-only and tester checks before any production change

1. Run `018-legacy-roster-readonly-verify.sql` in production. Expected before 018: legacy anon=false, authenticated=true; consented discovery anon=false, authenticated=true.
2. With consenting test accounts in the same event, verify an opted-out attendee does not appear in the *consent-based* People UI. Do not publicly paste real roster data.
3. Verify the actual authenticated legacy RPC still returns opted-out test attendees, or inspect its existing definition and grants as the documented bypass. Do not collect real user identities in logs.
4. Confirm testers use current supported iOS/web builds and check their network calls for legacy RPC dependencies. A source review alone is not enough.
5. Ensure the 018 rollback is saved outside Supabase and agree a short maintenance/test window; project dashboard previously showed no backups. Consider a database export/recovery plan before changes.

## After explicit production approval

Apply `018-legacy-roster-auth-revoke.sql` **only** after checks. Immediately verify legacy `authenticated_execute=false` and `anon_execute=false`, and consented discovery remains `authenticated_execute=true`. Test the actual authenticated API request for an explicit permission denial; check web/iOS People, profiles, QR, guest saves, message and check-in. Roll back only if a supported client regression is confirmed; rollback reopens the privacy gap.

## Remaining work

The legacy RPC revoke does **not** fix possible direct-table disclosure from `profiles` and `event_attendees`, nor other SECURITY DEFINER functions. Review effective RLS separately; avoid tightening broad table policies until the direct-reading iOS service is migrated to a consent-safe contract. No BLE-based inferred meeting or automatic connection is allowed.
