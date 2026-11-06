# Account QR event history

A signed-in personal QR scan saved the relationship but did not keep a separate event record when that relationship already existed. The history query also omitted claimed guest-to-member saves.

## Deploy in this order

1. In the authorized production Supabase SQL Editor, apply `008-account-qr-event-history.sql`. This requires the existing relationship RPCs (migrations 017/018), guest claim schema, and guest-to-guest connection table. The script is transactional and additive; rerunning it is safe.
2. Merge/deploy the frontend. GitHub Pages deployment does **not** apply the SQL file. The new frontend requires `save_account_qr_connection`; it deliberately cannot report success using the old relationship-only endpoint.
3. Sign in as Descartes, scan Nearifytester's personal QR for November 17 Show & Tell again, then open that connection's history. The event should appear once with “You saved via QR” and “Upcoming event.” Refresh and verify it persists.

Earlier unrecorded QR scans cannot be reconstructed reliably. Rescan missing event QRs after this update. No attendance rows are created. Event counts describe linked event records; save timestamps describe activity, while future scheduled dates are labeled separately.

## Validation

Run `npm test -- --maxWorkers=2 --minWorkers=1`, `node scripts/smoke-guest-flow.mjs`, and `python3 scripts/check-innerhtml.py`.

SQL integration tests run actual PostgreSQL through PGlite against the repository's relationship table/RPC migrations plus fixture dependencies. They cover an existing relationship gaining a second event, repeated and reciprocal scans, deduplication with attendance, atomic rollback, self/missing target rejection, account isolation, direct ledger access denial, and claimed guest-to-member history. The browser smoke test mocks backend responses; neither suite verifies the deployed Supabase database or physical Safari camera.

Production acceptance: scan two different event QRs for the same person; confirm both event records persist. Repeat one scan and confirm no extra event record. Scan your own QR and confirm no write. Verify the reciprocal account sees the event and that unrelated accounts cannot retrieve the pair's ledger.

## Rollback

Revert frontend files to their previous version if needed. Keep the additive ledger and history function so recorded event evidence is retained. Reverting the frontend stops recording new account QR event evidence; it does not erase saved relationships or existing event records.
