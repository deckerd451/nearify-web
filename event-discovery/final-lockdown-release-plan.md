# Final Nearify Supabase security lockdown — coordinated release

**Status: review-only. Do not deploy SQL or web/iOS builds merely because this PR merges.**

## Current risk
The old `get_public_event_attendees(uuid)` function may be executable by `anon`; permissive authenticated SELECT policies on `event_attendees` and `profiles` expose more data than discovery consent allows. Code migrations in GitHub do not remove these database privileges.

## Why this PR does not contain an executable blanket lockdown migration
We do not have the live catalog's exact RLS policy names, grants, column privileges, and complete iOS consumer inventory. Guessing a `DROP POLICY` or revoking all table SELECT can break check-in, joining, profile resolution, and unrelated app features. The attached read-only SQL inventories these details so a precise, reversible migration can be generated from verified facts.

## Release checklist — complete in order
1. Obtain verified, restorable backup or staging clone. Production is reportedly without managed backups; do not proceed without a recovery method.
2. Run `final-lockdown-preflight.sql` in staging and review all policies, signatures, function EXECUTE grants, and schema types.
3. Validate the SQL from consent foundation (#257), consented roster (#258), organizer aggregate (#261) **in staging**, and test with actual anonymous and authenticated JWTs.
4. Verify deployed web version uses only consented roster and aggregate organizer RPCs. Confirm iOS PR #692 and full iOS service inventory are compatible.
5. Confirm consent semantics for organizer analytics, historical events, and post-leave withdrawal.
6. Write exact, schema-verified SQL to:
   - revoke `anon` and unnecessary `public` EXECUTE on `get_public_event_attendees(uuid)`, or remove the function after proving zero callers;
   - replace permissive `event_attendees` SELECT with owner-scoped attendance reads plus any narrowly authorized server endpoints;
   - remove broad `profiles` SELECT and enforce safe public-profile reads separately from email/phone/private fields. **Row-level policies alone do not protect columns**; use restricted grants and/or a dedicated public projection;
   - preserve only necessary own-row writes for join, heartbeat, status, consent and intent.
7. Run cross-user and cross-event tests proving private goals, constraints, contact details and attendee identities are inaccessible via direct PostgREST, REST RPC, and web/iOS flows.
8. Prepare and rehearse exact rollback, including grants and policies; keep a verified backup and maintenance window.
9. Obtain explicit production deployment approval, execute controlled cutover, and immediately rerun privilege checks and smoke tests.
10. Monitor failures and document results. **Only then mark the vulnerability remediated.**

## Acceptance tests
- Anonymous legacy roster RPC is denied.
- Authenticated user cannot enumerate unrelated event attendance, goals, constraints, or contact details.
- Event roster shows only explicit opt-ins to fellow current attendees.
- Organizer insights are authorized server-side and do not return identifying records or small-group results.
- Former attendee can withdraw consent.
- iOS join, restore, check-in, heartbeat, intent updates, leave and rejoin work under tightened policies.
- Unrelated users cannot see private profile columns, regardless of `share_email` and `share_phone` flags.
- All SQL is applied in the right environment with recovery verified.

## Outstanding work
This PR is **not** the executable lockdown. The exact SQL depends on the catalog output and full compatibility tests. Do not represent this as a security fix or run a speculative migration.
