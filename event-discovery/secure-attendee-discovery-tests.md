# Secure attendee discovery — server RPC (phase 1)

**Draft implementation; not applied to Supabase.** This PR creates a *new* server-authorized roster endpoint. It does not change the live web or iOS clients and **does not yet remediate** the existing public roster endpoint or permissive table policies.

## Authorization contract
- Anonymous and missing-profile callers receive no rows; `anon` also lacks EXECUTE.
- Signed-in non-attendees receive no rows, even with a valid event UUID.
- Only signed-in, active attendees can request the roster for their event.
- Returned people must be active attendees with explicit `event_discovery_preferences.discoverable=true` for that same event.
- No `email`, phone, goals JSON, constraints, energy, user IDs, or other private profile fields are returned.
- Withdrawal or leaving removes a participant from the new RPC immediately.
- Own attendance is verified **independently** of whether the caller has opted into discovery.

## Preconditions to verify in staging
- The consent foundation migration is actually installed, not just merged to GitHub.
- Actual `profiles.interests` and `profiles.skills` types are `text[]`; change the return signature if schema differs.
- Actual attendee status values use `joined` and `inEvent`; revise if needed.
- SECURITY DEFINER owner, function search_path, role grants, and effective RLS match the intended trust model.
- Review whether `intent_primary` and `intent_secondary` are appropriate opt-in fields and provide explicit consent copy covering both.
- Assess whether organizer access should be aggregate-only and whether group size needs suppression.

## JWT-based staging regression matrix
| Caller | Expected |
| --- | --- |
| anon | EXECUTE denied |
| authenticated without profile | zero rows |
| authenticated with profile, not attending event | zero rows |
| active attendee | only active opted-in peers |
| attendee who did not opt in | can view consented peers, but is not listed |
| opted-in member after withdrawal | immediately absent |
| opted-in member after leave | immediately absent |
| attendee of event A querying event B | zero rows |
| direct `profiles`/`event_attendees` reads | **still unsafe until separate policy migration** |

Test cross-event IDs, forged profile IDs, event deletion, sign-out, and API errors. Confirm web and iOS joins, presence, event context, and relationships continue working.

## Coordinated cutover — REQUIRED before calling remediation complete
1. Inventory remaining mobile and web direct-table consumers and guest behavior.
2. Change web attendee discovery to call `get_consented_event_attendees` and separately verify caller attendance; avoid fetching raw roster first.
3. Implement opt-in/withdrawal UI with clear consent language; default remains off.
4. Replace organizer direct-table reads with an organizer-authorized aggregate RPC.
5. After all clients are compatible, revoke anonymous EXECUTE on `get_public_event_attendees(uuid)` and remove/replace broad `event_attendees` and `profiles` SELECT policies. Confirm no alternate SECURITY DEFINER leak.
6. Stage with representative data and actual JWTs, secure a verified backup/recovery plan, then obtain separate production migration approval.

## Rollback
Because this phase only adds a new endpoint, a staging rollback can revoke/drop `get_consented_event_attendees(uuid)` without changing existing data. Never deploy a restrictive migration without a tested rollback and client compatibility plan.
