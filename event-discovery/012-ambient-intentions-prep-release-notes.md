# Private follow-up intentions and event preparation

Private context now has a second optional field: “Next time we talk…” (280
characters), alongside the existing 1000-character note. Both are editable on web
and iOS. Home prioritizes a concrete intention over note-only context. Owners can
mark an intention done from the profile or Home; completion removes it from
context recommendations and preparation. Changing either context field resets
completion; saving identical values does not. Clearing both deletes the context.
Legacy note-only clients preserve the intention when changing or deleting a note.

Event preparation appears within a joined event's Home card on iOS and near the
start of the event sections on web. It is available from 14 days before the event
until three hours after its start, for currently joined/inEvent members only.
It contains at most three people with the caller's private context, ranked by
intention first, then context update date. Snoozed, completed and blocked people
are excluded. Each person must have one of:

- An opted-in listing from the existing consent-filtered roster for this exact
  event. This does not confirm physical presence or future attendance.
- A QR save made by the caller for this exact event. This does not imply the
  target has joined, opted into the roster or attended.

A historical label is shown only for the caller's actual earlier account QR
save at a different, past event. No event-name matching, previous-edition
inference, predictions of encounters, new location tracking or automatic
messages are introduced. There is no reliable series identifier in the current
schema, so this release does not attempt automatic matching across editions.
Someone having only a historical link, with neither a current opt-in listing nor
an exact-event save, is not suggested in that event's brief.

Both private fields remain out of messages, contact exports, analytics and public
profiles. The editable opener stays generic and does not include either field.
Server messaging approval and contact-sharing permissions are unchanged.

## Deploy

1. Apply `012-ambient-intentions-prep.sql` after the already installed 011 migration.
   It requires the existing `get_consented_event_attendees(uuid)` consent API.
2. Run `012-ambient-intentions-prep-verify.sql`: all three rows should pass.
3. Merge/deploy web and merge/pull iOS main. Build and run iOS in Xcode, then upload
   a new build for TestFlight users after device acceptance.

The migration is transactional and rerunnable. Existing clients continue using
011 APIs. New clients report a save error and retain their text if deployed
before SQL; event preparation quietly stays absent on an unavailable API. No
production SQL has been executed from this workspace.

## Validation

All 269 Vitest tests pass, including nine new PostgreSQL-compatible PGlite tests
for directional privacy, saved-person eligibility, length limits, legacy edits,
completion, exact-event evidence, opt-out, caller membership, blocks, snoozing,
date gating, deletion and rerun safety. The preparation tests install and execute
the real consent-filtered roster function, rather than trusting a client roster.

Headless Chromium checks pass:

- `node scripts/smoke-private-context.mjs`: edits, failed-save draft retention,
  retry, intention save/completion, private text rendering and no automatic send.
- `node scripts/smoke-event-preparation.mjs`: truthful labels, intention rendering,
  safe text, roster removal refresh, and private-data clearing on sign-out.

Changed Swift files pass syntax parsing. Added XCTest coverage for intention-only
context, completion suppression and decoding old note-only responses. This Linux
workspace cannot run Xcode or XCTest; a native build is still required.

## Device acceptance

- Create an intention without a note, verify it syncs between web/iOS, and check
  Home prioritizes it. Mark it done; verify it disappears from suggestions.
- Save unchanged context after completion; it stays done. Change the intention;
  it becomes available again. Verify both fields can be deleted.
- Join a near-term test event. Add private context for another opted-in member;
  preparation shows “Opted-in listing,” not confirmed attendance.
- With that member opted out, the listing disappears on refresh. If you saved
  their exact-event QR, the brief may still show your own save with its separate
  label. That save must not create an attendance claim.
- Confirm another account cannot read the intention or note, and sign-out,
  account switch, backgrounding, blocks and Later hide the relevant context.
- Test small-screen/large-text layout and the existing scanner, event join and
  explicit message-send flows.

Evaluate whether preparation reduces recall effort and leads to useful replies.
This release adds assistance; it does not establish an engagement improvement.
