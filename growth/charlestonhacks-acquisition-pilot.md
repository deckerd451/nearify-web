# CharlestonHacks × Nearify: single-event acquisition pilot

**Status:** proposal for review; no outreach, event listing, deployment, or data collection has been initiated.

## Confirmed pilot event (organizer-supplied flyer)

- **CharlestonHacks Show & Tell** — open mic night for creators
- **Tuesday, November 17, 2026 at 5:30 PM**
- **Freehouse Brewery**, 2895 Pringle St, North Charleston
- **Free and open to all**
- **Official RSVP: Meetup** (exact event URL not yet provided; do not invent one)
- User reports helping organize CharlestonHacks events; still coordinate any promotional placement with fellow organizers.

**Distribution approach:** Keep Meetup as the canonical RSVP. Introduce Nearify as an optional companion for making and remembering connections. Do not make Nearify registration a condition of attending. The attendee discovery feature must not be promoted or enabled before production privacy remediation.

**Event-specific prep:** confirm the exact Meetup RSVP URL, whether the event already exists in Nearify, and which channels organizers can use for an invitation. Use a single QR/link only after the destination and privacy behavior are verified.

## Hypothesis

Nearify's first constraint is acquiring a concentrated group of people at the **same event**, not adding product features. A CharlestonHacks event is a potential distribution partner, subject to organizer permission.

## Offer to attendees

> Going to a CharlestonHacks event? Nearify helps you find people worth meeting, remember who you met, and follow up afterward.

Avoid claiming attendee visibility until the consented-roster backend is deployed and its security verified. Until then, promote only features confirmed safe in production. Do not market the legacy attendee directory.

## Smallest viable pilot

1. Ask CharlestonHacks organizers for permission to trial Nearify at **one upcoming event**; confirm event date, venue, capacity, and communications channel. Do not assume a partnership.
2. Select a single event URL and confirm event listing, sign-in, join flow, and mobile experience. Avoid adding new database features before privacy remediation.
3. Have an organizer share a short opt-in invitation to their community, ideally 3–5 days before the event, plus one day-of reminder if permitted.
4. At the event, invite attendees to try Nearify voluntarily; explain the privacy controls and avoid collecting contacts without consent.
5. Ask participants one question afterward: **“Did Nearify help you make or remember a useful connection?”** Gather feedback without exposing individual attendee records.

## Proposed pilot targets (hypotheses, not forecasts)

| Funnel stage | Target | How to measure |
|---|---:|---|
| Unique visitors to event link | 30 | Existing privacy-conscious aggregate analytics, if available |
| New signups attributed to pilot | 10 | Aggregate counts; no email export |
| Attendees who successfully join event | 8 | Aggregate attendance, deduplicated by profile |
| Participants who report a useful connection | 4 | Voluntary short survey |
| Participants who would use it again | 5 | Voluntary short survey |

Targets are directional and should be revised based on the actual event size and organizer access. Do not infer engagement from total historical attendance rows.

## Instrumentation and privacy

- Use a unique campaign URL only if existing routing supports it; don't invent a working tracking link.
- Count aggregate visits, signups, joins, and post-event feedback. Do not expose emails, goals, constraints, or participant identities to organizers.
- Avoid introducing new analytics vendors or invasive tracking for this pilot.
- Consent-based discovery and production lockdown are prerequisites to promoting attendee discovery.

## Decision after pilot

- **Acquisition weak:** revisit organizer distribution and invitation copy, not more product features.
- **Signups but low event joins:** inspect onboarding, authentication and event-link friction.
- **Joins but little perceived value:** interview attendees about match relevance and follow-up.
- **Positive connection feedback:** repeat with a second event and compare conversion.

## Organizer outreach draft

Subject: Small Nearify pilot at a CharlestonHacks event?

Hi CharlestonHacks team,

I'm working on Nearify, a tool intended to help people make more useful connections at in-person events and remember those connections afterward.

Would you be open to a small, optional pilot at one upcoming CharlestonHacks gathering? I'd keep it lightweight: one event link, a short invitation if you're comfortable sharing it, and a few questions afterward about whether it helped attendees connect.

No commitment to an ongoing partnership, and we'd only proceed once the attendee privacy controls are ready.

Thanks for considering it!

## Release guardrail

This plan is documentation only. Do not announce attendee discovery, ship the consented roster, or expose participant data until the known production Supabase vulnerabilities are remediated and verified. Any outreach must be approved and sent by the owner.
