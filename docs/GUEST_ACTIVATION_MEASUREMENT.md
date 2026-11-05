# Guest scanning and activation measurement

## Scanner behavior

`qrScanner.js` prefers `BarcodeDetector` when QR support is reported. Otherwise,
it loads the locally served jsQR 1.4.0 decoder on demand. A native detection
failure also switches to jsQR. Frames stay in the browser and are downscaled to
at most 960 pixels on the longest edge; no camera images are uploaded.

The camera uses an ideal rear-facing constraint and muted inline video. Camera
permission failure, unavailable devices, and decoder failures leave the pasted
Nearify-link path available. A detected QR stops the camera before one save is
attempted; retrying requires another action. Stopping, leaving the connect view,
hiding the tab, or leaving the page releases tracks and cancels the scan timer.
Late permission results are discarded and their tracks stopped after navigation.

## Recorded events

New events use the existing insert-only `analytics_events` table. No database
migration or access-policy change is required.

| Event | Trigger |
| --- | --- |
| `guest_event_opened` | Signed-out event details loaded |
| `guest_join_viewed` | A valid event's guest flow loaded |
| `guest_session_created` | Guest creation RPC succeeded (existing event name) |
| `guest_join_failed` | Guest creation request failed |
| `guest_scan_requested` | Visitor asks to open the camera |
| `guest_scan_started` | Camera is playing and decoder is ready |
| `guest_scan_failed` | Permission, camera, decoder loading, or decoding failed |
| `guest_connection_save_requested` | A camera, pasted link, or incoming QR handoff starts a save |
| `guest_connection_saved` | Save RPC succeeded, even if history refresh fails |
| `guest_connection_save_failed` | Invalid QR, missing session, or failed save request |
| `guest_claim_started` | Visitor chooses sign-in to claim guest connections |
| `guest_claim_failed` | Sign-in initiation or pending guest recovery fails |
| `guest_account_claimed` | Atomic guest network claim RPC succeeds |

Only fixed values for `method`, `decoder`, `connection_kind`, `reason`, and
`source` are accepted, plus a random `journey_id`. New guest events exclude
names, profile/guest IDs, QR URLs, share codes, guest tokens, camera frames,
query strings, referrers, and raw server errors. The required `event_id` is the
event being measured, not the person or QR target. Existing analytics events
outside this funnel retain their existing schema; their referrers are reduced
to an origin so same-site QR query strings are not recorded.

The journey ID lives in sessionStorage, scoped to one event and browser tab.
It survives same-tab navigation and sign-in redirects when storage is retained.
Page-entry, guest-creation, and claim-success events are recorded at most once
per tab/event when storage is available. Failures and explicit retry actions
can repeat. Storage denial does not block the guest flow; correlation may be
incomplete. Analytics insert failures are absorbed and do not block app actions.

## Read-only activation report

Run through an existing authorized reporting or SQL-admin context. This does
not grant client access to analytics or require new RLS policies. It was not
executed against production during implementation.

```sql
with journeys as (
  select event_id, properties->>'journey_id' as journey_id,
    bool_or(event_name = 'guest_event_opened') as opened,
    bool_or(event_name = 'guest_join_viewed') as entered,
    bool_or(event_name = 'guest_session_created') as joined,
    bool_or(event_name = 'guest_scan_started') as scanned,
    bool_or(event_name = 'guest_connection_saved') as saved,
    bool_or(event_name = 'guest_account_claimed') as claimed
  from public.analytics_events
  where created_at >= now() - interval '30 days'
    and properties->>'journey_id' is not null
  group by event_id, properties->>'journey_id'
)
select event_id,
  count(*) filter (where opened) as event_page_journeys,
  count(*) filter (where entered) as guest_flow_journeys,
  count(*) filter (where joined) as new_guest_journeys,
  count(*) filter (where scanned) as camera_started_journeys,
  count(*) filter (where joined and saved) as activated_new_guest_journeys,
  count(*) filter (where joined and saved and claimed) as recovered_new_guest_journeys,
  round(100.0 * count(*) filter (where joined and saved)
    / nullif(count(*) filter (where joined), 0), 1) as activation_percent
from journeys
group by event_id;
```

Activation here means a new guest journey with at least one confirmed save.
These are journeys, not unique people; multiple tabs or cleared storage can
produce multiple journeys. Direct QR arrivals can skip event details. Returning
guests may save without a new guest-creation event. Date-window boundaries,
blocked tracking, and sign-in opening another tab can undercount conversions.
Use distinct journeys for conversion, rather than summing repeated save events.
Do not describe frontend events as proof of account identity or reciprocal
connections.

## Validation

- `npm test -- --maxWorkers=2 --minWorkers=1`
- `node scripts/smoke-guest-flow.mjs` (installed Chromium or `CHROMIUM_PATH`)
- `python3 scripts/check-innerhtml.py`

The browser check uses a simulated backend and real generated QR pixels. Physical
iPhone camera quality, lighting, and Safari permission UX still need a device
smoke check after deployment. No production writes or schema changes are part
of this validation.
