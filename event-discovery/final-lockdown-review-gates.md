# Final lockdown: schema-grounded review and release gates

**REVIEW ONLY — not a deployable migration.** This document records confirmed production exposure and the exact decisions needed before writing/executing final DDL. GitHub merges do not run Supabase SQL.

## Confirmed from production read-only inventory (previous operator-provided results)

- `public.event_attendees`: authenticated SELECT policy `authenticated users can view event attendees` uses `true`. Rows include private `goals`, `constraints`, `energy_level` and intent fields.
- `public.profiles`: authenticated SELECT policy `profiles are viewable by authenticated users` uses `true`. Rows include `email`, `public_email`, `public_phone` irrespective of `share_email` / `share_phone`.
- `public.get_public_event_attendees(uuid)` is SECURITY DEFINER and executable by `anon`. Existing implementation may return attendee information to anonymous callers.
- The new consent foundation and RPCs are **GitHub files, not yet installed in production**.
- `profiles.skills` and `profiles.interests` are PostgreSQL `text[]`; organizer SQL in this PR now uses `unnest` rather than comma-splitting serialized arrays.

## Proposed cutover order (requires staging and approved backup)

1. Establish a **verified restorable** production backup and an isolated test database with synthetic users. Do not use production as a test database.
2. Re-run `event-discovery/final-lockdown-preflight.sql`; record complete policy definitions, grants, column privileges, function definitions/signatures, and actual deployed client versions. Inventory all profile and attendee readers (web, iOS, and any server jobs).
3. Apply and validate consent foundation, consented attendee RPC, and corrected organizer insights RPC **in staging only**, in dependency order. Confirm default-off consent, opt-in, opt-out after leaving, and organizer authorization.
4. Replace broad attendee SELECT with carefully scoped own-row reads and required server-mediated operations. Preserve own-row INSERT/UPDATE rules and test join/check-in/heartbeat/leave/rejoin. Verify all statuses used by clients.
5. Remove broad profile SELECT **without exposing private columns through a replacement broad row policy**. RLS restricts rows, not columns. Design a public projection with only approved fields, and separately scoped access for the user's full profile; verify existing consumers and column/table grants.
6. Disable anonymous legacy roster access and then retire legacy function only after all callers are removed. Audit other SECURITY DEFINER functions individually; `anon` EXECUTE by itself is not proof of an exploitable flaw.
7. Rehearse the exact rollback on staging, obtain explicit operator approval, deploy during a maintenance window, and run the post-cutover privilege and client smoke tests.

## Minimum staging test matrix

| Actor / action | Expected |
|---|---|
| Anonymous calls legacy attendee RPC | Denied |
| Anonymous reads attendee table or private profiles | Denied |
| Authenticated user reads another attendee's goals/constraints | Denied |
| Authenticated user enumerates unrelated event attendees | Denied |
| Authenticated user reads another user's email/phone without consent | Denied |
| Current attendee calls consented roster | Only currently active, opted-in attendees returned |
| Nonattendee calls consented roster | No roster |
| Former attendee withdraws consent | Allowed; remains undiscoverable |
| Nonorganizer calls organizer insights | Denied |
| Organizer calls insights with fewer than 5 active attendees | Suppressed |
| Organizer sees tag with embedded comma | Tag preserved exactly, not split |
| iOS join, check-in, intent update, heartbeat, leave, rejoin | Works for own identity, cross-user writes denied |
| Organizer / participant accesses different event | No cross-event leakage |

## SQL work still blocked

Do **not** run speculative `DROP POLICY`, blanket `REVOKE SELECT`, or `DROP FUNCTION` in production. The final executable lockdown and rollback must be generated only after the above catalog, dependencies, test results, and recovery method are verified. In particular, profile data cannot be made safe by simply changing a SELECT RLS predicate while leaving sensitive columns in broadly readable rows.

## Reviewer decisions

- Approve the public profile field allowlist and how contact-sharing flags are enforced.
- Confirm whether organizer aggregate insights may use all active attendees or only consented attendees.
- Confirm iOS compatibility and minimum supported app version before revoking legacy access.
- Confirm recovery/rollback ownership and production deployment window.

**Security status: production vulnerabilities remain open until the database cutover is performed and verified.**
