# Community Signal — isolated Nearify prototype

This feature branch adds a standalone browser prototype at `community-signal/index.html`. Open the file locally or serve it as a static page. It does **not** modify the current Nearify application, database, routes, or production deployment.

## What works in the prototype
- Browse three fictional community profiles.
- Simulate a recipient's opt-in preference.
- Send a local-only acknowledgement, once per person.
- Switch to the recipient inbox and reciprocate.
- Inspect a local activity history.

All state is in memory and disappears on refresh. The prototype does not send real messages, identify real people, or access LinkedIn.

## Production integration checklist
1. Inspect Nearify's existing authentication, member model, deployment and database policies.
2. Require authenticated senders and recipient opt-in before storing or delivering a signal.
3. Add tables for preferences and signals with server-enforced uniqueness, rate limits, blocking, and row-level access controls.
4. Implement notification delivery only for opted-in recipients, with mute/unsubscribe and abuse reporting.
5. Add accessibility and integration tests, audit logging, retention limits, and a privacy review.
6. Pilot with consenting community members before enabling discovery or recommendations.

**Do not treat a third-party profile visit as an acknowledgement delivered by Nearify.** External platforms require their own authorized workflows.

## Authenticated implementation candidate (not deployed)

- `live.html` imports Nearify's existing `assets/js/supabaseClient.js` and uses the signed-in session.
- `migration.sql` defines opt-in preferences, signals, row-level policies, a limited opt-in discovery RPC, and a send RPC.
- The SQL migration **has not been applied** to the hosted Supabase project. The page will show a database-unavailable message until it is applied.
- The standalone page is not linked from the main navigation.
- Sender/recipient UUID prefixes are placeholders in the inbox; profile display-name resolution, recipient blocking, moderation, notification delivery, retention/deletion controls, and integration tests remain necessary before a public rollout.
- Database policy migration must be reviewed against existing `profiles` schema and deployment practices before applying. Never deploy this migration without confirming that assumptions match production.
- There is no LinkedIn automation or external outreach.

### Review and validation

1. Review `migration.sql` against the live database schema and existing migrations.
2. Apply to an isolated Supabase test project, never directly to production.
3. Test anonymous access, self-signalling, non-opted-in recipients, repeated sends, concurrent daily-limit enforcement, and RLS visibility.
4. Sign in with two consenting test accounts and validate opt-in, discovery, acknowledgement, and inbox behavior.
5. Add proper profile presentation, blocking/reporting, consent withdrawal and deletion semantics, then run automated browser tests.

## Mutual acknowledgement (feature branch)

The authenticated `live.html` page now detects two-way acknowledgements among the signals it loads, displays a **Mutual interest** section, and offers **Acknowledge back** for incoming signals. It does not automatically send introductions, messages, or external notifications.

**Known limitation:** The page currently loads the latest 100 participant-visible signals and computes mutual matches in the browser. This is sufficient for an early limited pilot, but production should use a server-side paginated mutual-match query to avoid missing older matches. The UI uses participant names from the discoverable member list when available, otherwise an abbreviated ID. Blocking, consent withdrawal, and a dedicated mutual-introduction workflow still need design and implementation.

### Manual acceptance scenarios

1. With two opted-in test accounts A and B, A acknowledges B; B sees an incoming acknowledgement.
2. B chooses **Acknowledge back**; both accounts show mutual interest on refresh.
3. Repeating an acknowledgement does not create a second signal.
4. Non-participating recipients cannot be acknowledged.
5. No messages or notifications are sent automatically.
