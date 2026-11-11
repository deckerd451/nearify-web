# Guest discovery release gate — issue #316

**Status:** source review and read-only database inventory only. No guest roster is authorized by this document.

## Reuse, don't rebuild

- Existing authenticated, consent-filtered attendee discovery: `assets/js/eventDetail.js`, `get_consented_event_attendees`.
- Existing event opt-in says **only signed-in attendees** can view visible profiles. It is **not consent for anonymous guest discovery**.
- Existing anonymous event check-in, QR exchange and saved connections: `assets/js/join.js` and guest session/QR services.
- Existing `015-event-connection-people.sql` explicitly grants authenticated users only. Do not make it public.

## Step 1 — manual read-only inspection

Run `016-guest-discovery-access-preflight.sql` in **staging first**, then in production only after reviewing its scope. Capture all four result sets. It makes no schema/data changes. The older `final-lockdown-preflight.sql` and `001-verify-consent-install.sql` overlap; do not rerun migrations to satisfy missing checks.

**Interpretation:** an existing RPC and its EXECUTE grant are not proof of row-level authorization. A direct table SELECT grant may still be constrained by RLS. Missing RPC signatures may mean a different overload exists. Check every listed overload, effective policies and legacy endpoints. This query cannot establish whether production has a data leak.

## Step 2 — actual authorization tests (separate from SQL Editor)

Use isolated browser sessions and real Supabase JWT contexts; never simulate guest access with a service-role key. Confirm network/API responses, not just whether UI cards are hidden.

| Caller / state | Expected current behavior |
| --- | --- |
| Anonymous, no event check-in | No identifiable roster or private goals |
| Anonymous, valid guest event session | QR and own saved connections work; **no identifiable roster** |
| Signed-in non-attendee | No event roster |
| Signed-in co-attendee, discovery off | May view consented peers; not visible to others |
| Signed-in co-attendee, discovery on | Only explicitly opted-in peer fields visible |
| Blocked person | Excluded according to server-side block policy |
| Different event | No cross-event attendee information |
| Withdrawn consent | No longer visible to new authorized roster requests |
| Legacy anonymous roster RPC/direct REST | Must not bypass the consent model |

Also check past-event access, revoked/expired guest tokens, repeat QR scans and guest-to-guest event scoping. Record failures before implementing any guest UI.

## Step 3 — product decision required

**Default recommendation:** retain guest QR as the sole primary action until there is a separately worded, opt-in **guest-visible** audience consent, reviewed minimal profile fields, server-side event-scoped authorization, block/withdrawal enforcement and abuse controls. Never silently expand the existing signed-in-only audience.

Only after that decision, reuse existing attendee card presentation and add at most one clear guest action or empty state. Do not build a parallel attendee directory, auto-save connections, infer a conversation from BLE, or add a sign-in wall.

## Step 4 — measurable acceptance

Instrument a privacy-conscious guest-to-meaningful-save outcome, distinguishing internal test sessions from external engagement where feasible. Counts alone do not prove a sequential conversion funnel. Test on actual iPhone Safari and desktop, including QR camera permissions, return visits and small screens.

**Merge of this documentation does not mean production has been verified.** Share the actual read-only query results for review before any guest-discovery implementation.
