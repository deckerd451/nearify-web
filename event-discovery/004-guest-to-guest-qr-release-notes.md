# Guest-to-guest QR foundation — release gate

This PR is **database foundation only**. It does not enable guest-to-guest UI, does not modify the existing profile QR flow, and does not install SQL automatically. **Do not run migration 002 as part of this change.**

## Privacy and threat model

- The private `ghost_token` stays in browser storage and RPC request bodies; **never** encode it in a QR, URL, analytics event, or logs.
- The displayed QR will contain an event-scoped public `share_code` (64 hex characters), not a private session token. Anyone physically shown the QR can save that guest; treat it as a shareable capability.
- Both source guest identity and target share code must belong to the **same event**. Self-scans are rejected; repeated scans are idempotent.
- The new tables have RLS enabled and no direct anon/authenticated table access. Only owner-token-verified RPCs can read outgoing guest connection names.
- The existing account-claim flow only handles guest-to-profile `interaction_events`. **Guest-to-guest rows are not yet claimable or shown in the returning account dashboard.** Do not promise permanent recovery until a follow-up migration maps both sides to claimed profiles.
- No directory or guest roster endpoint is created. Rate limiting and abuse monitoring should be evaluated before high-volume rollout; public QR codes are intentionally shareable.

## Deployment sequence

1. Run **`004-read-only-preflight.sql` first** in Supabase SQL Editor and share its output. This checks key columns, primary key, built-in randomness, and collisions with existing guest QR objects without changing data. A pass is necessary but not sufficient; verify the production schema and permissions before installing `004-guest-to-guest-qr-foundation.sql`. Neither file has been run against production by this PR.
2. After review, run SQL manually in the existing Supabase SQL Editor.
3. Verify anon has no direct SELECT on either table, and EXECUTE only on the three narrowly scoped functions.
4. In a **separate PR**, add a guest QR display, scanner recognition for guest share URLs, and outgoing guest history. Feature-gate UI until SQL is verified.
5. Before describing guest-to-guest connections as recoverable after sign-in, implement and test authenticated claim of guest-to-guest edges and the dashboard projection.

## Manual verification (two isolated browsers)

- Create guest A and B in the same event, retrieve each guest's share code with their own private token.
- A scans B: one outgoing connection appears for A; scanning twice produces no duplicate.
- A's history does not reveal B's private token or B's outgoing connections.
- A cannot read B's history by passing B's ID with A's token.
- A cannot save their own code, an unknown code, or a code for a different event.
- An unauthenticated direct SELECT from both new tables is denied.
- Existing guest-to-profile scans and account claims remain unchanged.
- Once B is claimed, its QR becomes unavailable for new guest-to-guest saves; historical outgoing records remain available to A.

## Rollback

This migration creates isolated tables/functions only. If not used yet, revoke EXECUTE on the three new functions to disable guest-to-guest writes/reads without touching existing guest-to-profile connections. Do not drop tables containing user connections without a retention/export decision.
