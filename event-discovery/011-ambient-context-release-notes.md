# Ambient conversation context

This release adds owner-only notes across iOS and web. New native QR saves offer
an optional note and Skip. Existing people can have notes added, edited or deleted
on their profiles. Web account QR saves link to the profile note editor. Notes
are account-only; anonymous guest sessions still work without writing notes.

Home prioritizes unread messages and requests, then the freshest relevant private
note (within 30 days). Accepted connections get Continue conversation. Saved
people without approval get Review connection, which opens the profile for the
explicit invitation flow. Saving a note never grants messaging permission.

Later hides the note-based suggestion for seven days. A successful outbound
message newer than the note suppresses it. Opening a conversation or a failed
send does not count. Editing a note resets its context date; saving unchanged text
does not restart the suggestion. Deleting removes the note; blocked people are
excluded from Home's context API. Notes remain readable/deletable by their owner
in profile history even after blocking.

Conversations provide a collapsed private note and an optional editable opener.
The opener is fixed text: it does not copy the note, infer a meeting or attendance,
call an AI service, overwrite a nonempty draft, or send automatically. No push
notifications, background location, contact disclosure, or new analytics are added.
The normal send button and server authorization remain authoritative.

## Deploy in this order

1. Apply `011-ambient-context.sql` in the Supabase SQL editor after migration 010.
   It creates one private table and four authenticated-only APIs; it is rerunnable.
2. Run `011-ambient-context-verify.sql`. Both checks should return true.
3. Merge/deploy the web branch and merge/pull the iOS branch.
4. Build/run and test the iOS app in Xcode; upload a new build for TestFlight users.

If clients deploy first, notes report unavailable and existing saves/messages
continue. SQL must still be installed for notes to work. Existing notes are not
public profile fields, messaging content or exported contact fields. Direct
client table access is denied with RLS enabled; functions derive owner identity
from the authenticated session and take no caller-supplied owner ID.

## Validation

- All 260 web/Vitest tests pass, including seven new SQL tests executed with
  PostgreSQL-compatible PGlite. Checks cover directional owner isolation,
  anonymous/direct-access denial, length limits, block handling, snooze, unchanged
  saves, outgoing-message evidence, rerun safety, and deployment verification.
- `node scripts/smoke-private-context.mjs` passes in headless Chromium. It verifies
  safe text rendering, retained edits after failed saves, retry, and an opener
  that excludes private notes and never calls send.
- iOS changed/new Swift files pass syntax parsing. Added XCTest policy coverage
  for note eligibility, stale/snoozed/sent suppression and removal of generic
  saved-person nudges. Xcode build/XCTest were not run in the Linux workspace.

Device acceptance: save a real person's QR; skip once, then add a note from their
profile. Confirm the other account cannot read it. Approve a connection and check
Home offers it; use the opener, edit and explicitly send. Confirm the suggestion
then disappears. Repeat with Later, delete, account switch, background/foreground,
blocked contact, failed send and migration unavailable. Verify large text sizes
and that all existing event and messaging flows still work.

This is a hypothesis about reducing effort, not a proven engagement improvement.
Pilot with consenting testers and compare perceived follow-up ease and actual
replies. Do not log note or message contents to measure adoption.
