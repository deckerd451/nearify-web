# Separate connection approval from personal contact sharing

## Resulting behavior

Discover → acknowledge → mutual interest → explicit invitation → recipient accepts → Nearify messaging → optional, directional personal-detail disclosure.

- Acknowledgement does not send a message, create a connection, or reveal details. Mutual Community Signals offer Invite to connect. Discovery can show the owner's existing public bio as context; no work or meeting history is invented.
- A QR saves the person/context. It does not create an accepted messaging connection or share contact information. Saved QR people remain findable in web My Connections and iOS People → Saved people.
- Connect on Nearify / Accept connection enables messaging only. Existing accepted connections retain messaging.
- Share my contact details selects individual fields for one recipient. Sharing is never automatically reciprocal. Request contact details creates a separate inbox item and reveals nothing. The owner may share selected fields or ignore it.
- Stop sharing removes future API reads/exports without deleting the messaging connection. Downloaded/imported copies cannot be recalled. The owner can revoke even after the other person blocks them. Blocking removes the blocker's outgoing disclosure and suppresses new signals, messages and requests.
- Editing a private preference never publishes a new value to prior recipients. Turning off a field's availability prunes that field from future reads of prior disclosures.

## Important: coordinated release, not a standalone web update

**Do not run 010 against production until an updated iOS build is prepared and tested on a staging database.** The existing iOS build automatically inserts accepted connections from QR scans and reads sharing fields directly from profiles. Those behaviors conflict with the new consent model and deliberately stop working after this migration.

Required companion branch in both repositories: `codex/connection-permissions`.

1. Review the web SQL/UI branch and the iOS branch together. Run Xcode build + BeaconTests with the companion iOS changes; Linux source parsing is not a substitute. The synchronized Xcode source/test groups include the new files automatically.
2. In a staging Supabase project with the existing 008/009 and Community Signal schema, apply 010 and test the matrix below with staged web/iOS builds. Check existing profile policies and dependent database functions against the moved fields.
3. Prepare/upload the updated iOS build for distribution. Schedule the production database, web deployment, and iOS distribution as a coordinated release. Warn existing testers to update; old builds fail closed for QR auto-accept and cannot use the new contact editor/export flow. There is no claim of backward-compatible personal-data access.
4. Apply `010-connection-permissions.sql` in the authorized production SQL Editor, then deploy the web branch and distribute the prepared iOS build. Git merges do not execute SQL. The SQL is transactional and rerunnable.
5. Test both directions with two accounts before expanding the rollout. No production SQL, contact invitations, or messages were sent during development.

## Data migration and preservation

New private tables store owner contact preferences, directional disclosures, detail requests, and saved people. Direct public/anonymous/authenticated table access is revoked; owner/recipient APIs derive identity from authentication.

The first application copies the seven sharing fields from `profiles` into the owner's private preferences, then clears those sharing fields on the public profile row. This avoids bypassing recipient consent through ordinary profile queries. It does **not** drop profile columns, alter bio/identity fields, or use login email as contact information. Blank legacy profile updates/upserts preserve the private store. Nonempty sharing-field writes from old clients are rejected; updated clients must use the private preference API. Trusted maintenance of an existing profile can capture nonempty legacy fields into the private store and blank them before publication.

One-time grants preserve the contact access already available between existing accepted, unblocked pairs at migration time, including existing availability flags. They are marked `legacy_accepted`. This is preservation of the old contract, not evidence of a new per-recipient choice. No new acceptance creates disclosures. A rollout marker prevents rerunning the migration from restoring revoked grants. A staging restore/backup should be available before this migration, as with any migration moving live personal data.

Existing 009 conversation/message policies continue to enforce participant identity and accepted connection status. A new connection trigger rejects unilateral accepted inserts and requester self-approval. Private disclosures stay separate from `relationships` (saved/mutual-save history), `connections` (messaging approval), and Community Signal acknowledgements.

## Acceptance matrix

1. A and B opt into Community Signal. A acknowledges B; B acknowledges back. No messages, accepted connection or details appear. Mutual interest offers Invite to connect. B can accept/ignore. Opted-out targets cannot receive new Community Signal invitations or acknowledgements; blocks also prevent new messages and connection requests.
2. A scans B's QR on web and iOS. The person appears in saved people and the correct event context is retained when supplied. Messaging remains unavailable until recipient approval. Repeat scans do not duplicate the saved person.
3. After connection approval, both accounts can message across clients; email/phone/links remain absent unless a directional grant exists. A request does not reveal information.
4. A selects email only and shares with B. B can read/export email, not A's phone. A receives no B details in return. Verify with a third account and raw profile/table queries as well as UI buttons.
5. B requests A's details on either client. A sees the separate request in web Messages / iOS Messages, can choose fields, or ignore. Connection requests remain distinct from detail requests.
6. A revokes. B's next API read/export contains no A details; messaging still works. Disable email availability and verify prior email access is pruned. Changing an email value does not silently push the new value to existing recipients.
7. Block, then revoke; unblock does not restore the blocker's outgoing personal details. Existing conversation history remains readable. Reapply 010 and verify revoked grants stay revoked and private preferences remain intact.
8. Test owner preference editing, empty/malformed links, failed-send drafts, exports, sign-out/account switching, mobile layouts and iOS permission dialogs.

## Validation and limitations

Web: `npm test -- --maxWorkers=2 --minWorkers=1`, both browser smoke scripts, JS syntax and innerHTML audit. PostgreSQL/PGlite tests execute real migration SQL and cover one-time preservation, directional sharing, revoke/prune, invitation identity, save-only QR semantics, server authorization and blocked acknowledgements. Browser tests mock Supabase and exercise the actual DOM flow, not live interoperability.

The iOS companion adds native connection/detail screens, private preference loading/editing, safe contact export, details-request inbox entries, saved people, and explicit invitation routing. XCTest contract tests are included. New/modified Swift was parsed for syntax against the base revision; an existing parser limitation in HomeView is unchanged. No Xcode/iOS SDK is available here: full type checking, signing, XCTest execution, TestFlight distribution and physical-device validation remain required.

## Rollback

Keep the private records, grant history and approval guards. Reverting a client does not restore the prior data contract. Do not reapply 009 after 010 or repopulate public contact fields as an automatic rollback; either would undo or misrepresent the new privacy model. Use a coordinated hotfix or explicitly reviewed database recovery plan. Already downloaded contact cards are outside Nearify's revocation boundary.
