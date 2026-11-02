# Consent foundation release 001

**Implemented in this PR:** one atomic, additive SQL migration that installs event-specific discovery preferences, a caller-scoped preference RPC, an authenticated attendee-only consented roster, and organizer aggregate insights. It uses the already-reviewed SQL from this repository. No Docker or second Supabase project is required to author the change.

## Execution

1. Verify a restorable database backup and compare the current live schema to the source SQL. This migration creates policies with fixed names; it is **not idempotent** if they already exist.
2. Apply `001-install-consent-foundation.sql` once to the intended Supabase environment through the SQL editor. The script is transactional.
3. Run `001-verify-consent-install.sql` and confirm that `anon_execute` is false for all three new RPCs.
4. Test two distinct authenticated accounts: an attendee can read only their own preference, can opt in and out, and can discover only other active opted-in attendees of the same event. A non-attendee cannot get a roster.
5. Test an organizer against a different organizer's event, and suppression for events with fewer than five active attendees.

## Compatibility and limitations

The migration is **additive**: it does not change guest join, ghost QR save, profile claim, or existing iOS RPC signatures. It also **does not remove** the existing permissive `profiles` and `event_attendees` SELECT policies or revoke legacy `get_public_event_attendees` execution. Those exposures remain until the second, coordinated cutover.

Do not represent this migration as completing the privacy fix. Do not deploy the second cutover until client call sites, safe profile projection, backup restore, and JWT-backed tests are verified.
