# Nearify staging lockdown rehearsal — **not a production migration**

This branch contains a **rollback-only** SQL rehearsal for a local Supabase database populated with synthetic accounts. It is not a deployable production migration.

## Why this is necessary

Verified production observations indicate a broad `SELECT USING (true)` policy on both `public.event_attendees` and `public.profiles`, and anonymous EXECUTE on `get_public_event_attendees(uuid)`. These expose private attendee goals, constraints, intents, and profile contact details. UI changes alone do not repair them.

## Setup / safe order

1. Create or restore a **separate local staging database**. Never connect this script to the hosted production database. Do not import real participant PII.
2. Apply the repository's `consent-foundation.sql`, `consented-attendees-rpc.sql`, and `organizer-insights-aggregate-rpc.sql` in staging. Their dependencies and function signatures must be checked against the local schema.
3. Run `final-lockdown-preflight.sql` read-only; confirm policies, function grants, table grants, and column grants. Review every additional policy that might still allow cross-user reads.
4. Run `staging-lockdown-rehearsal.psql` with psql and an explicit `nearify_staging_ack` variable. **It ends in ROLLBACK, even when successful.** It proves only that the candidate SQL can be parsed and applied inside a transaction.
5. Perform **separate JWT-backed integration tests** in a disposable staging clone with a reviewed *committed* staging-only variant, covering anon, user A, user B, organizers, join/check-in/heartbeat/leave/rejoin, and profile/contact fields. The rollback rehearsal does not test those behaviors.

## Outstanding blockers before production

- **Backup:** production has no verified restorable backup. No production SQL without one.
- **Other RLS policies:** dropping two broad policies does not prove no other policy grants read access. PostgreSQL permissive policies combine with OR.
- **Column-level access:** profiles contain `email`, `public_email`, `public_phone`, `share_email`, and `share_phone`. RLS is row-level, not field-level. The candidate locks profiles to own-row reads; this may break public profiles and iOS flows until a safe public projection is implemented.
- **Other SECURITY DEFINER functions:** inspect `ensure_profile`, `get_event_context`, `join_event`, and `update_attendee_intent` with actual JWTs. Anonymous EXECUTE by itself does not prove vulnerability, but merits review.
- **Guest connection flow:** verify personal QR and ghost-save paths do not depend on the legacy roster.
- **Organizer aggregates:** validate authorization and suppression with 0, 4, 5, and 6 active synthetic attendees.
- **Cross-user regression:** direct REST table reads must not return other people's attendance, intent, goals, constraints, or private contact details; consented roster must show only opted-in active attendees to current attendees.
- **Release choreography:** web/iOS clients, grants, policies, rollback plan, and production approval must be coordinated.

## Critical warning

The rehearsal does **not** prove security fixed. Do not merge it into a production migrations directory, execute it against production, or remove the final `rollback;`. The next deliverable after staging access is a JWT-backed test harness and a schema-verified migration with exact rollback.
