# Privacy status

The current, checked state of attendee privacy. Update this file whenever the checks are re-run.

## Last checked: 2026-11-18, production Supabase, by the owner

Query: `supabase/diagnostics/verify_20261118e_signed_out_attendee_access.sql` (read-only).

| Check | Result |
|---|---|
| Legacy roster `get_public_event_attendees(uuid)` | **Nobody can run it.** No execute for `anon`, `authenticated` or `PUBLIC`. |
| `event_attendees` table | **No read policy applies to signed-out visitors.** |
| `profiles` table | **No read policy applies to signed-out visitors.** |

Before turning the function off, all three codebases were searched (Nearify web, `nearify-ios`, `charlestonhacks.github.io`). None of them call `get_public_event_attendees`. It was already off when checked, so `apply_if_needed_20261118e_disable_legacy_roster.sql` was not run.

**What this closes:** the anonymous attendee-list exposure described in `docs/LEGACY_ROSTER_REMEDIATION_017.md`, and the legacy-roster consent bypass in `docs/LEGACY_ROSTER_018_AUTHENTICATED_GATE.md`, since signed-in users can no longer run the function either.

## Bluetooth proximity: paused and deleted (2026-11-18, production, by the owner)

The iOS app broadcast a fixed Bluetooth identity (`BCN-<profile UUID prefix>`) while checked in, and recorded person-to-person encounters automatically. It's paused while it's redesigned.

| Step | Result |
|---|---|
| `public.encounters`: `insert` and `update` revoked from `authenticated`, all access revoked from `anon` | Confirmed: signed-in users can't add or update, and signed-out visitors have no access |
| `public.encounter_fragments` | Not present in production |
| Stored encounter records | **All 94 deleted** (the newest was from 2026-09-17). 0 remain. |
| iOS app | `AmbientProximity.isEnabled = false` ([nearify-ios#817](https://github.com/deckerd451/nearify-ios/pull/817)): no Bluetooth broadcast or scan, no encounters, no UWB, no location or Bluetooth prompts. Encounter files on the phone are deleted at launch. **Pending: device test and TestFlight release.** |

Proximity comes back only with the redesign in `nearify-ios/docs/AMBIENT_PROXIMITY_PAUSE.md`: rotating server-issued identifiers, opt-in per event, nothing shown live, mutual-only connection, raw data deleted after the event, and an independent security review.

## Not covered by this check
- What signed-in users can read directly. For example, `profiles` has a "viewable by authenticated users" policy, and `event_attendees` rows are readable by co-attendees under its own policies.
- Other tables and functions, including the consent RPCs and Community Signal (see PR #242).
- Behaviour tested with real accounts. This was a privilege and policy check, not a three-account test.

## Product decision (2026-11-18)
Nearify won't build features that show other people's attendance or plans, such as "Maya is going." Features show people only their own data: their notes, their saved people, and their own card. "People you might see" before an event is built only from the viewer's own notes and never reads attendance.
