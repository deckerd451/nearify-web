# Release 002: owner-only SELECT and legacy roster revocation

This PR adds **executable** security SQL. It has **not been executed**. It targets the exact two SELECT policy names and RPC signature verified by the operator.

## Changes

- Replaces broad authenticated `profiles` SELECT with `profiles_select_own` (`profiles.user_id = auth.uid()`).
- Replaces broad authenticated `event_attendees` SELECT with `event_attendees_select_own` (attendance belongs to the caller's profile).
- Revokes legacy `get_public_event_attendees(uuid)` EXECUTE from PUBLIC, anon and authenticated.
- Leaves all four existing profile/attendance INSERT and UPDATE policies unchanged.
- Retains the consented roster and organizer RPCs from migration 001.

## Compatibility evidence

Inspected `assets/js/join.js`, `assets/js/eventDetail.js`, `assets/js/dashboard.js` and `Beacon/Services/EventContextService.swift`. Their inspected direct profile/attendance reads for join, own intent, own attendance, and iOS event-context fallback are own-row lookups. Dashboard cross-user attendance recommendation helpers still exist but are not active on the current dashboard path.

**Not proven:** full web/iOS caller inventory, other profile and network views, all SECURITY DEFINER function behaviors, authenticated JWT-backed tests, or safe public profile projection. A public profile projection may be required before this cutover. Restricting SELECT can break UPDATE paths if own-row SELECT is not available; the migration preserves own-row SELECT for that reason.

## Release gates

1. Verify a restorable production backup and capture existing policies and grants.
2. Verify current clients no longer call `get_public_event_attendees`; audit other web/iOS profile reads and supply a safe public-profile projection as needed.
3. Validate separate authenticated users and anonymous access: owner reads succeed; cross-user attendance, goals, constraints, email and phone fail; opted-in roster works.
4. Verify guest join, ghost QR save, claim, profile updates, iOS join/restore/heartbeat/leave/rejoin, and organizer insights.
5. Execute `002-owner-only-select-cutover.sql` only with explicit production execution approval. It is transactional and aborts on unexpected SELECT/ALL policies.
6. Recheck policies and RPC grants immediately. `002-emergency-rollback.sql` is available for emergency recovery but deliberately reintroduces the original privacy exposure; prefer correcting the broken client instead.

**Merging this PR is not database deployment.**
