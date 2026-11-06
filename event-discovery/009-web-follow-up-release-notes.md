# Web follow-up using the shared iOS backend

Saved profiles now offer follow-up actions above collapsed event history. `/messages/` provides contact requests, conversations, text messaging, earlier-message paging, and unread state. Approved contacts expose only their chosen email/phone and profile links, with vCard download. Nearify iOS installation is optional for these web actions.

## Data and approval contracts

Reviewed `deckerd451/nearify-ios` main at `56057f1`, specifically `MessagingService`, `ConnectionService`, `ContactShareService`, the conversation/message models, preferred-contact fields, and shared read-state migrations.

- Reuse `connections`, `conversations`, `messages`, and `conversation_reads`, identified by `profiles.id`. A user on web and the same user on iOS share the same thread and read timestamps.
- An accepted `connections` record enables messaging. A blocked record in either direction takes precedence. A saved or mutually confirmed `relationships` record alone does **not** approve contact sharing; no automatic conversion is performed.
- Existing accepted iOS connections work immediately. Otherwise, the web offers request / pending / approve / ignore. Only an incoming pending request can be approved. Requests do not fabricate event attendance. Acceptance follows the existing iOS contract, which also uses accepted connections for QR connections.
- Approved external contact information comes from `public_email` only when `share_email=true`, `public_phone` only when `share_phone=true`, and the existing LinkedIn/website fields. Login email is never returned or exported. Those fields continue to be managed through the existing iOS profile editor; this release does not add a web profile editor.
- Blocking prevents new sends through RPCs and direct authenticated REST inserts, including iOS. Existing messages remain readable. Users can undo their own block, which does not itself grant a new approval. Older iOS builds may still display a send button after a block, but server policy rejects the send.

## Deployment order — SQL first

1. Apply `009-web-follow-up.sql` in the authorized Supabase SQL Editor **before merging/deploying the frontend**. GitHub Pages does not execute SQL. The SQL is transactional and rerunnable. It requires the existing iOS `connections` schema (`requester_profile_id`, `addressee_profile_id`, nullable `event_id`, status/created/updated timestamps) and `current_profile_id()`. It creates missing shared messaging tables with the same iOS contracts and adds missing optional contact fields.
2. Review the new restrictive RLS policies alongside deployed policies. These deliberately prevent conversation creation without an accepted connection, sender spoofing, non-participant reads, and new messages after a block, even when an older permissive policy exists. They apply to both clients. Text is limited to 4,000 characters. Ordinary users cannot update or delete thread/message rows through these policies; account-deletion service workflows retain their privileged access.
3. Deploy the frontend. New cached module references make Messages available from the account menu and mobile drawer. The web refreshes active inbox/thread state every 10 seconds, profile follow-up state every 15 seconds, and navigation counts every 30 seconds. Background polling pauses. The inbox lists the most recent 100 conversations and up to 100 incoming requests; individual threads page through all messages. No browser push notifications are introduced; existing server message triggers, if deployed, still process shared table inserts.
4. Run the cross-platform acceptance checks below. No production SQL or live messaging writes were performed during development.

If SQL is not yet installed, the UI shows an unavailable/retry state; it does not pretend to send messages or reveal unapproved details.

## Acceptance checks

- Existing iOS accepted pair: open the person on web, select Say hello/Message, and send a message. Verify it appears in the existing iOS thread. Reply on iOS and verify it appears on web; reload both clients. Check unread state clears after viewing the latest incoming message.
- Saved-only web pair: Exchange contact shows Pending. Recipient sees the request in web Messages and the iOS contact-request flow. Approve on either platform, then verify messaging unlocks on web and shared contact fields follow the owner's settings. Ignore does not unlock messaging. Repeated clicks create no duplicate pending request.
- Send failure: draft remains; retry retains the message ID to avoid duplicate sends. Earlier-message paging retains the draft and scroll position.
- Contact card: inspect that unshared email/phone are absent. Malformed URLs and executable schemes are not linked or exported. Existing iOS profile preferences remain authoritative.
- Block: new sends fail from both clients, history remains visible, and undoing someone else's block is impossible. Unblocking your own contact does not automatically approve a new exchange.
- Sign-out/account switch clears displayed messages. Anonymous and unrelated accounts cannot call thread APIs or read thread tables. Test widths 320/390/768/1280.

## Local verification

`npm test -- --maxWorkers=2 --minWorkers=1`

`node scripts/smoke-follow-up.mjs`

`node scripts/smoke-guest-flow.mjs`

`python3 scripts/check-innerhtml.py`

PostgreSQL/PGlite integration tests execute the actual migration, including restrictive-policy tests with intentionally broad legacy policies. Browser checks use mocked backend responses and cover request/approval, safe links/export, thread send/retry, draft retention, persisted rendering, block, auth cleanup, and responsive layouts. These are not live Supabase or physical iOS interoperability tests.

## Rollback

Revert frontend files to remove web follow-up. Keep messages, requests, contacts, and read records; never drop tables to roll back the UI. The restrictive shared policies are independent authorization improvements; review any policy rollback separately because removing them reopens older direct-API permissions. Existing frontend QR saving is unchanged.
