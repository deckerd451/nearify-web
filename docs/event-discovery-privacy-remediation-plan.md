# Privacy remediation implementation plan — review before production SQL

**Status: proposed; NOT deployed or approved for execution.** Based on the two read-only production SQL audits shared on 2026-11-01 and a source review of `assets/js/eventDetail.js` and `assets/js/organizerInsights.js`. This plan does not assert that all consumers (including the iOS app) have been audited.

## Confirmed exposures

- `public.event_attendees` has an authenticated SELECT RLS policy with `USING (true)`. Columns include `intent_primary`, `intent_secondary`, `goals`, `constraints`, and `energy_level`.
- `public.profiles` has an authenticated SELECT RLS policy with `USING (true)`. Columns include `email`, `public_email`, `public_phone`, `share_email`, and `share_phone`. The flags do not limit direct table SELECT.
- `public.get_public_event_attendees(uuid)` is SECURITY DEFINER, executable by `anon`, and its implementation explicitly returns profile IDs, names, and `intent_primary` to unauthenticated callers. The guest path is not co-attendee gated.
- `get_event_context`, `get_my_connections`, `join_event`, `leave_event`, and `update_attendee_intent` are also granted to `anon`, though several check the authenticated caller internally. Review each before changing grants.
- Community Signal discovery separately enforces bilateral opt-in. This does **not** confer consent for event attendee discovery.

## Known web dependencies to preserve

| Consumer | Current access | Replacement requirement |
| --- | --- | --- |
| `assets/js/eventDetail.js:fetchAttendeeIntent` | Own profile and own attendee intent via table SELECT | Own-attendance context RPC |
| `assets/js/eventDetail.js:fetchEventAttendees` | Event attendee rows + profile names/photos/interests/skills | Consent-filtered, co-attendee-authorized RPC with minimal fields |
| `assets/js/eventDetail.js:loadAttendeeDiscovery` | Reads attendee data before checking co-attendee access in UI | Server-enforced gate; do not send private roster to unauthorized clients |
| `assets/js/organizerInsights.js` | Raw event intents + profile interests/skills | Authorized organizer-only aggregate RPC; avoid returning individual profiles |
| Existing event join/leave and connection flows | Direct tables and SECURITY DEFINER RPCs | Regression tests before policy changes |
| iOS application and guest join flows | **Not yet inventoried** | Required compatibility audit before rollout |

## Recommended staged rollout

### 0. Immediate mitigation decision (requires product owner approval)
Consider revoking anonymous EXECUTE on `get_public_event_attendees(uuid)` after identifying every guest/iOS consumer. **Do not apply blindly:** guest join may depend on it. A replacement that returns only non-identifying counts is preferable if guest UI needs momentum. A staged feature flag or maintenance notice may be necessary if urgent containment is chosen.

### 1. Define discovery consent
Introduce an explicit event-specific discoverability preference, default **false**. Attending does not opt in. Sharing an event goal is separate from selecting a goal for personal planning. Define withdrawal, past-event behavior, blocked users, and whether organizers can see any identity-level data. Document the consent copy and update privacy notice before launch.

### 2. Build server-authorized access paths
- A caller-owned context RPC for the current member's own attendance/goal.
- A co-attendee RPC that verifies `auth.uid()` and event membership, excludes non-opted-in members, and returns only explicitly agreed fields. Never return `goals`, `constraints`, `energy_level`, email, phone, or user IDs by default.
- A separate organizer aggregate RPC that verifies organizer privileges server-side and returns counts/aggregates only. Consider suppressing very small groups.
- Public event momentum should return only carefully reviewed non-identifying data.
- SECURITY DEFINER functions must set safe `search_path`, qualify referenced objects, and explicitly validate caller authorization.

### 3. Retire broad SELECT policies only after consumer migration
Replace `USING (true)` SELECT policies on `event_attendees` and `profiles` with minimum necessary own-row access, plus narrowly scoped server-authorized RPCs. **Do not simply restrict profiles to own-row until login, QR, connections, event discovery, and iOS dependencies are inventoried.** Evaluate column-level privileges or a public-profile projection if appropriate.

### 4. Test authorization, privacy, and compatibility
Test with actual Supabase `anon` and authenticated JWT roles (SQL Editor's privileged session is not an adequate RLS test):

- Anonymous: no identifiable attendee roster, goals, or private profile fields.
- Authenticated non-attendee: no roster or private attendee goals.
- Co-attendee without discovery opt-in: not listed, but can still attend and manage their own goal.
- Opted-in co-attendee: only consented fields visible to authorized viewers.
- Withdrawal: removed from discovery immediately; historical/past event behavior verified.
- Organizer: aggregate access only, with server-side organizer authorization.
- User with a connection: existing Save/Saved/Connected states still work.
- Join, leave, rejoin, calendar, profile, QR, guest join, and iOS flows continue to work.
- Direct REST reads and RPC calls cannot bypass the new rules; test cross-event and guessed UUID access.

### 5. Production release gate
Before executing any migration:
1. Inventory iOS and other API consumers; inspect all affected SQL/RPC definitions and grants.
2. Review an exact migration **and rollback** against a staging clone with representative data.
3. Arrange verified backups/recovery. Production reportedly has no managed backups; do not rely on a rollback script alone.
4. Deploy application compatibility changes before or atomically with restrictive policies, using an approved rollout sequence.
5. Monitor auth, event joins, profile access, organizer insights, and RPC errors; validate privacy with test identities.
6. Obtain explicit owner approval for SQL execution. Do not merge/deploy from this planning PR automatically.

## Proposed SQL shape (illustrative, NOT executable migration)

```sql
-- Example ONLY. Do not run in production.
-- Future migration should:
--   add opt-in event discoverability with DEFAULT FALSE;
--   create authorized, minimal-field attendee/organizer RPCs;
--   migrate web/iOS callers;
--   revoke unsafe anonymous RPC access;
--   replace permissive attendee/profile SELECT policies;
--   include explicit grants, regression tests, and a recovery plan.
```

## Open questions
- Which guest join and iOS screens call `get_public_event_attendees`?
- Do any mobile clients query `profiles` or `event_attendees` directly?
- Are email/phone fields protected by column grants or other access layers? Confirm actual effective PostgREST behavior.
- Which RPCs and policies power organizer authorization and relationships?
- Is event discovery allowed for past events, and how does withdrawal affect historical records?

**Decision required:** approve a compatibility inventory and server-side consent design before authorizing production SQL.
