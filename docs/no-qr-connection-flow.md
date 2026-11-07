# No-QR event connection flow

Public copy: “Meet people. Keep in touch.” Supporting promise: “Find each other at an event, choose to connect, and continue the conversation in Nearify. No contact exchange needed.”

## Rollout

1. Apply nearify-web/event-discovery/015-event-connection-people.sql after 014 to the shared Nearify database.
2. Run 015-event-connection-people-verify.sql; both rows must pass.
3. Deploy web and build iOS in Xcode. No Innovation Engine deployment or permissions expansion is needed.

The new read-only API reuses the exact-event member/opt-in roster, removes self and blocks in either direction, and respects dismissed suggestions. Unlike preparation's three suggestions, it supports the full event people list. It returns only consented profile fields, never phone/email/private notes. It neither saves an encounter nor sends invitations.

iOS: joined/pre-event cards and the live Room page link to “Find people at this event.” That list includes a name search and an explicit per-event visibility toggle (off by default), then opens the existing profile and connection request UI. A person's visibility switch does not send them any request.

Web: joined members can search consented event names and open “View profile & connect.” The profile uses the existing request/accept APIs. Unavailable reads display retry. Guests keep QR/link recovery and must sign in for discovery/messaging. Landing and Vision explain the same flow without implying automatic attendance, message recording, or automatic connection.

## Device acceptance

Use two signed-in accounts, joined to the same event, with no QR save or prior connection. Enable visibility on the target account. Find it by name on the other account, open profile, and connect. Before acceptance, messaging must be blocked. Accept on the target account, then message across web/iOS. Email/phone must remain hidden until explicitly shared. Verify visibility off removes the profile on refresh; unrelated-event and signed-out users cannot browse; blocked accounts are absent; QR fallback still works. Test loading failures, auth switches, accessibility text, and light/dark mode. In iOS the live Room entry must work as well as the pre-event entry.

## Validation

308 web tests passed, including PostgreSQL tests for no-QR request/accept, messaging gate, no automatic personal disclosure, exact-event membership, opt-out, both block directions, and anonymous denial. Home browser regression passed. Vision rendered without horizontal overflow at 390px/1280px. Changed Swift source passed syntax parsing. Xcode build/XCTest and physical-device acceptance remain required; no Apple toolchain here. No production accounts or messages were used.
