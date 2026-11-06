# Browser QR scanning entry

The main site header exposes **Scan QR** outside the mobile hamburger on the
homepage, event list/details, guest join, connections, profile, Vision, and admin
pages. It opens `/scan/?web=1`. The scan page has no authentication or external
SDK dependency: it uses the local `qrScanner.js` and decoder, with a paste-link
fallback. Its URL is outside the iOS association's application routes.

Supported codes are Nearify HTTPS event links, guest/personal `/join/` links,
and the existing `beacon://event/<uuid>` venue format. The scanner resolves
these to local browser routes, adding `web=1`. It never opens arbitrary hosts,
JavaScript URLs, auth-token deep links, or unknown custom schemes. The visitor
chooses **Continue in browser** after a valid code is detected.

New guest QRs, personal QRs, dashboard join links, event share links, and admin
external-event join links include `web=1`. Both Apple app association documents
are identical. Their `web=1` exclusions precede ordinary app-link rules for
join, event, and profile paths; unflagged app links continue working normally.

Apple and installed devices cache association files. A merge does not prove
Apple has refreshed them. Old printed codes and iOS-generated codes without
`web=1` can still open the installed app when read with the phone's Camera app.
Using **Scan QR inside the website** avoids that OS-level handoff. No client
JavaScript can intercept a URL after iOS has already chosen to open the app.

Signed-in browser event scans open the event page. A signed-in guest-QR scan
uses the existing token-verified guest-save RPC followed by `claim_guest_network`
to save into the account; credentials are retained when recovery fails. Signed-in member
personal scans use the authenticated `confirm_relationship` RPC directly,
without creating or reusing a guest session. Self scans are identified before
any write. Repeated saves use the RPC’s existing idempotent behavior; a one-sided
save is not presented as a mutual connection. Failed writes do not
render a successful connection message. No new database permissions or migrations
are introduced.

Validation:

- `npm test -- --maxWorkers=2 --minWorkers=1`
- `node scripts/smoke-guest-flow.mjs`
- `python3 scripts/check-innerhtml.py`

Browser checks use generated QR pixels, synthetic camera streams, and a simulated
backend. Check a physical iPhone after deployment for the visible header action,
permission behavior, and universal-link handling. Existing iOS-generated QR
formats other than the supported formats above require an example before adding
another parser.

## Guest camera visibility

The guest **Scan someone's QR** button opens a native camera dialog before
requesting permission. It keeps the live preview in view rather than appending
it below the visitor's large personal QR. The dialog provides Close, Stop camera,
and a paste-link fallback, and closes on Escape or a successful save. Closing
releases active tracks and discards any late permission result. Browsers without
native dialog support are routed to the standalone web scanner.

Playback is explicitly muted, inline, and autoplay-enabled. Browser validation
asserts that the video has a visible size inside the phone viewport before a
synthetic QR frame is released for decoding. This is not a physical Safari camera
test. Neither web scanner uses MediaRecorder or records video.

## Guest QR handoff outcomes

Following **Continue in browser** with a guest or personal target enters an
explicit saving stage. A successful RPC shows the saved confirmation and then
removes the target from the address bar. Failed handoffs retain their target
and show a visible error with retry and scan-another actions; errors are not
left inside the closed camera dialog. Back to my QR explicitly dismisses the
pending target.

The caller's token-authorized share-code RPC identifies their own guest QR.
Self scans do not attempt a connection write. This comparison uses the actual
share code, never a display name. Event-only QRs are labeled as event QRs on the
scanner result page so joining an event is not mistaken for saving a person.

The browser smoke check uses the canonical HTTPS origin for route validation,
while serving all static responses from a local server and simulating every
backend request. It covers self, pending, failed, retried and successful guest
handoffs, plus failed/retried personal QR handoffs.
