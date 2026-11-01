# Event discovery consent foundation: review and verification

**Not applied to production.** The SQL in `event-discovery/consent-foundation.sql` is additive only.

## Intended guarantees
- No preference row exists by default, interpreted as **false**.
- Only authenticated users can access the preference table and helper RPC.
- Users may only view/change their own preference; setting true requires current event attendance.
- Event participation alone does not enable discovery.
- This phase does **not** return or publish any attendee information.
- This phase does **not** fix broad `profiles`/`event_attendees` SELECT or the anonymous `get_public_event_attendees` RPC.

## Preflight before any execution
1. Confirm actual `event_attendees.status` values and `profiles.user_id` mapping in staging. The current SQL assumes `joined`/`inEvent` are the active statuses; revise if necessary.
2. Confirm no existing `event_discovery_preferences` table or same-named RPC, policies, triggers or grants. The migration is intended for a fresh deployment, not repeated execution.
3. Confirm RLS policy subqueries against `profiles` and `event_attendees` behave as intended under authenticated JWTs.
4. Obtain tested backup/recovery capability, since production reportedly lacks managed backups.
5. Run on staging and review a rollback plan before production.

## Required staging test matrix
- Anonymous table SELECT/INSERT/UPDATE/DELETE and RPC EXECUTE denied.
- Authenticated non-attendee cannot insert discoverable=true for an event.
- Attendee can insert their own false/true preference and read it through RPC.
- A different authenticated user cannot read or mutate that preference.
- User can withdraw by setting false or deleting own row; RPC returns false afterward.
- Leaving the event prevents new opt-in (existing opt-in must also be ignored by future roster RPC when not active).
- Existing join, leave, attendance heartbeat, profile resolution, event context and iOS restoration remain functional.
- No consent data is returned to unrelated members.

## Future security migration (separate PR)
1. Implement co-attendee-authorized, consent-filtered roster RPC and server-authorized organizer aggregates.
2. Update web and iOS consumers; confirm guest behavior.
3. Revoke unsafe anonymous roster access and replace broad SELECT policies.
4. Test direct PostgREST calls with anon, non-attendee, attendee, organizer identities.
5. Coordinate release and rollback; do not treat this consent foundation as a completed privacy fix.

## Rollback consideration
Before anyone writes preferences, this isolated table and RPC can be dropped in staging. After user choices exist, preserve/export those records before any rollback; dropping the table would erase consent history. Never use a destructive rollback on production without explicit approval.
