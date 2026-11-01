# Organizer Insights RPC: staging verification and release gates

## Source-verified authorization
The web repository defines `events.created_by = profiles.id` and `profiles.user_id = auth.users.id`. The new RPC checks this join against `auth.uid()` for the exact requested event. Browser `canManageEvent()` is not an authorization boundary.

## Response contract
`get_organizer_event_insights(p_event_id uuid)` returns a JSON object containing `suppressed`, `total`, `withGoals`, `sortedGoals`, `topInterests`, `topSkills`. No profile IDs, names, emails, phone numbers, raw attendee rows or individual goal values are returned.

Counts are restricted to active attendance statuses `joined` and `inEvent`. Entire output is suppressed for fewer than five attendees; individual goal/tag groups with fewer than three contributors are excluded. **The choice to aggregate non-opted-in attendee information needs explicit privacy/product approval**, since event discovery opt-in is not the same as analytics consent.

## Must verify in staging
1. Confirm `events.created_by`, `profiles.user_id`, `event_attendees.status`, `intent_primary`, `interests` and `skills` types with read-only schema queries. In particular the SQL's comma-splitting tag normalization assumes commas are safe delimiters; validate real values and choose type-specific handling before applying.
2. Execute SQL only in staging after a verified rollback plan. Test anonymous caller, signed-in non-organizer, organizer of a different event, and actual organizer with real JWTs.
3. Test zero, four, five and larger attendees, goal/tag group sizes two and three, and events with no goals. Verify no identifying values or rare categories leak.
4. Compare aggregate values against existing Organizer Insights with staging fixtures. Note that the new query counts **active** attendees, unlike the old direct query, which did not filter status.
5. Verify browser error handling if the RPC is not installed: it shows a failure message and does not fall back to unsafe table queries.
6. Verify browser displays suppressed events without raw totals. Check event ownership transfer, deleted profiles, and revoked sessions.
7. Confirm the privacy policy and organizer disclosure for aggregate reporting, including treatment of opted-out users.
8. Audit iOS and other consumers before the later RLS lockdown.

## Explicitly not included
- No production SQL execution, deployment, or permissions changes.
- No changes to legacy `get_public_event_attendees`, broad `profiles` SELECT or broad `event_attendees` SELECT policies.
- No evidence that Supabase schema or real JWT behavior was tested.
- No claim that privacy remediation is complete.

**Deployment order:** validate/apply aggregate RPC in staging, test web against staging, confirm privacy policy, then coordinate production migration and web release. Do not deploy web code before its RPC exists.
