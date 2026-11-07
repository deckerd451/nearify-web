# QR routing, preparation, and Home rollout

Apply `nearify-web/event-discovery/014-event-preparation-contract.sql` to the shared Nearify database after migration 013, then run `014-event-preparation-contract-verify.sql`. Both checks must return true. This adds one read-only authenticated preparation API; it does not change attendance, messaging permission, or Innovation Engine live authorization.

Deploy nearify-web and build the latest nearify-ios branch in Xcode. No Innovation Engine deployment is required.

## Device acceptance checks

1. Scan a member personal QR: save the person without joining or checking into the linked event.
2. Scan a guest personal QR: explicitly continue in the embedded browser; no native check-in. Test while signed out too. Guest saving remains a browser flow.
3. Scan a real event QR: join/check-in applies only to that event. Malformed, ambiguous, duplicate-key, and insecure web links must not route. Check legacy beacon and UUID routes still work.
4. Before check-in, a joined event can show up to three opted-in profiles. Open a profile and verify the correct person. Opted-out, blocked, dismissed, and unauthorized-event profiles must be absent. A profile listing does not confirm attendance.
5. Home shows one primary next action: pending conversation/request, optional event review, useful saved context, or an upcoming event. An empty review must not obscure another action. Secondary events and saved people are collapsed.
6. Simulate a failed read: Home offers retry rather than claiming everything is up to date. Sign out or switch accounts and verify private content clears.
7. Review/snooze/dismiss and opening a conversation must never send a message or share contact details automatically.

## Verification performed

305 web tests passed, including PostgreSQL preparation authorization tests and shared QR contract cases. Browser fixtures passed for Home, event preparation, and post-event review. Innovation Engine live-boundary regression passed. Changed Swift files passed syntax parsing. Xcode compilation, XCTest execution, and physical-device acceptance remain required; this Linux workspace has no Apple toolchain. Browser checks use fixtures, not production accounts.
