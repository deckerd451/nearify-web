# Staging-only privacy lockdown validation

**No production SQL execution.** Use a separate local Supabase environment and synthetic profiles. Do not copy real attendee data.

## Known exposure

- `event_attendees`: authenticated SELECT policy `authenticated users can view event attendees` with `USING (true)`.
- `profiles`: authenticated SELECT policy `profiles are viewable by authenticated users` with `USING (true)`.
- `get_public_event_attendees(uuid)`: legacy RPC executable by `anon`, exposing identities without adequate consent checks.

## Candidate cutover, pending schema verification

1. Apply consent foundation and consented roster RPC in staging.
2. Replace the two permissive SELECT policies with own-row access, preserving existing own-row INSERT/UPDATE policies.
3. Revoke PUBLIC, anon, and authenticated execution of the legacy roster RPC after proving no active callers.
4. Keep a dedicated safe public profile projection if iOS/web requires viewing other users; row-level policies alone do not hide private columns.
5. Validate every other SELECT policy and SECURITY DEFINER RPC to prevent bypasses.
6. Confirm organizer insights authorization and aggregate suppression.

## Required integration tests

With separate real authenticated JWTs for two synthetic users, plus anon and organizer:

- Anon cannot execute legacy roster.
- User A cannot read user B's attendance, goals, constraints, or contact fields through PostgREST.
- User A sees only opted-in active participants through the consented roster when A is attending.
- Non-attendee receives no consented roster.
- Organizer sees only permitted aggregate insights; events with fewer than five participants are suppressed.
- Joining, check-in, heartbeat, leave, rejoin, consent withdrawal, personal QR saves, and account claim still work.
- Verify mobile web and iOS compatibility and rollback on a restorable staging clone.

## Production release blockers

Production has no verified restorable backup. Do not run DDL there. A reviewed migration, tested rollback, confirmed client compatibility, and explicit production approval are required. Merging this documentation does not fix the vulnerability.
