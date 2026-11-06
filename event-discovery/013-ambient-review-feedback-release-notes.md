# Quiet post-event review and persistent suggestion feedback

Nearify retains context and surfaces it quietly. Adding a note, reviewing a person,
sending a message and choosing feedback remain optional, explicit user actions.
There is no required review, automatic message, modal on event exit or new push
notification.

Home on iOS and the Connections page on web can offer a collapsed review of
people saved by the caller's QR actions for an event. It does not count Bluetooth
proximity or assert that saving proves a meeting or attendance. The list is
limited to 100 distinct saved people and excludes blocked/dismissed suggestions.

An iOS review receipt is recorded asynchronously only after explicit Finish Event
success. Re-check-in, dormancy and summary refresh never create it or launch a
modal. Failure to record cannot block finishing. The receipt is a client
statement, not independent proof of attendance. Duplicate receipts with the same
session start preserve prior dismissal. A later distinct session can offer a new
review.

For web-only use, the server can offer a review after an event's actual recorded
ends_at, using the caller's QR records. Missing end times are not inferred. Reviews
expire after seven days; Later hides them for one day, and Done dismisses the
current review/session. Web actions do not finish an event or change membership.

“Not relevant” hides a person from automatic Home and preparation suggestions.
It persists independently of note edits, across updated web/iOS clients. It is not
a block or deletion: saved profiles, private notes and conversations remain
accessible. The private context section on a profile includes Restore automatic
suggestions. Actual unread conversations and incoming requests still appear as
activity, even when a recommendation for that person is dismissed.

## Deploy

Apply web `event-discovery/013-ambient-review-feedback.sql` after 012. Run
`013-ambient-review-feedback-verify.sql`: both rows should pass. This adds two
private RLS tables and four authenticated-only APIs, and updates owner-context
and preparation reads. The migration is rerunnable and creates no automatic
publications, messages, attendance records or notification jobs.

Then merge/deploy web, merge/pull iOS main and build/run in Xcode. A new TestFlight
build is required for distributed iOS users. No production SQL was run here.
If the API is unavailable, reviews stay absent and affected preference writes
report an error; event exit still completes. Updated iOS hides automatic people
recommendations while feedback preferences are unknown.

## Verification

All 278 web/Vitest tests pass, including nine new PGlite tests covering privacy,
authentication, actual QR counts/deduplication, membership, no participation
mutation, review Later/Done/idempotency, directional feedback, restoring,
completion-history independence, blocks, invalid/future sessions, rerun safety,
and web-only recorded-end review.

Browser checks pass:
- `node scripts/smoke-private-context.mjs`: failed-save recovery, intention
  completion, hiding/restoring suggestions without losing notes, and no auto-send.
- `node scripts/smoke-post-event-review.mjs`: review initially collapsed, safe
  text rendering, failed-dismissal recovery, Later/Done, auth cleanup and no
  event-finish or send-message calls.

Swift syntax checks pass. Added native policy and source-boundary regressions for
persistent dismissal and recording a receipt only after a successful explicit
finish. Xcode/XCTest cannot run in this Linux environment.

## iPhone acceptance

1. Save a real person's QR for an event. Explicitly finish the event. Home should
   return normally and offer an optional review, without automatically opening it.
2. Review a person, optionally add a private note, then select Done reviewing.
   The card should disappear across refreshed web/iOS views.
3. Test Later: hides for a day. Replaying the same finish receipt must not reopen
   it; a genuinely new checked-in session can produce a fresh review.
4. Select Not relevant on a suggestion. It disappears from automatic Home and
   preparation, remains saved, and can be restored from the person's private
   context section. Another user's suggestions must remain unaffected.
5. Verify unread conversations/requests still appear; blocked people never appear
   in the automatic review list. Background/switch accounts to check private
   context clearing.
6. Repeat the previous Finish Event regression sequence (check in, cancel finish,
   finish successfully, check in again); no holding screen or automatic wrap-up.
