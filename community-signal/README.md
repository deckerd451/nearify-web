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
