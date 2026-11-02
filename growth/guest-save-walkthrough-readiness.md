# Nearify guest → saved connection: Show & Tell readiness gate

**Review only.** No production deployment, database mutation, or attendee invitation is authorized by this document. Based on code review, not an executed browser or iOS test.

## Core promise to validate

At the November 17 CharlestonHacks Show & Tell, a person should be able to scan a personal connect QR, identify the person they met, and retain that connection without installing TestFlight first. Meetup remains the event RSVP system.

## Findings from current code

1. `join/index.html` offers a guest name flow, but promotes TestFlight as the primary action. `assets/js/join.js` changes its CTA for `source=meetup` into an iOS deep-link path; guest entry is not the primary Meetup journey.
2. `assets/js/ghostSession.js` stores an event-specific guest token in localStorage. `assets/js/ghostConnection.js` calls `record_ghost_connection`; `join.js` can later call `claim_ghost_activity`.
3. The guest attendee search and live previews in `join.js` call **`get_public_event_attendees`**, an anonymous-accessible legacy RPC with a known production privacy issue. **Do not drive attendees to this flow or market attendee discovery before backend lockdown.** Merely hiding UI is not a security fix.
4. The `maybeAutoClaimGhostForAuthenticatedUser` code previously cleared local guest recovery keys even after a failed claim or missing profile. This PR preserves them for retry, clearing only after a successful claim. This is a defensive code change, **not** an end-to-end validation or a privacy remediation.
5. `join.js` contains an email capture message promising a recap; verify an actual email delivery system before making that promise to attendees.

## Manual walkthrough (staging with synthetic profiles only)

Use two synthetic test users and one synthetic event. Use private/incognito browser sessions on actual mobile devices; never use real participant PII.

| Step | Action | Pass condition |
|---|---|---|
| 1 | Open valid event join URL without session | Event identity is correct; no dead-end or unwanted TestFlight requirement |
| 2 | Join as guest with display name | Ghost session created; clear explanation of what is saved |
| 3 | Scan another user's personal QR (`?event=...&profile=...`) | Correct person shown, connection recorded exactly once |
| 4 | Refresh and reopen on same device | Guest history persists; no phantom connection |
| 5 | Attempt to save the same person again | No duplicate or false “connected” claim |
| 6 | Trigger failed sign-in/claim, then retry | Guest recovery keys persist on failure; connection survives and claims exactly once on success |
| 7 | Return after successful claim | Saved connection appears in authenticated My Connections |
| 8 | Try with zero other attendees | Useful honest empty state; no misleading recommendation or attendance claims |
| 9 | Test Meetup-source join link | Guest flow available without mandatory TestFlight, or record as blocker |
| 10 | Test iPhone Safari, Android Chrome, and desktop | QR and sign-in flow work; no unsupported app-only dependency |
| 11 | Test logged-out attendee table/RPC access | Legacy roster and sensitive data inaccessible after security migration |
| 12 | Confirm post-event recap behavior | No promised email unless delivery is verified |

## Stop-ship conditions

- Anonymous `get_public_event_attendees` still reveals identities/intents.
- Direct `profiles` or `event_attendees` queries still expose private fields.
- Guest save / claim silently loses data or claims the wrong person.
- Meetup handoff forces TestFlight or prevents a browser-first pilot.
- “Recap email” is promised without confirmed delivery.

## Next PR after privacy staging

Once backend lockdown is verified, prioritize a browser-first Meetup entry path, replace the legacy guest roster with consent-compliant access (or remove it), make “save the person I met” the first action, and give honest empty states. Do not implement those changes against unverified production RPCs.

## Pilot success criteria

With 5 voluntary testers, at least 4 can save one connection without coaching and 4 can retrieve it after refreshing or signing in. Record only aggregate results and anonymous feedback.
