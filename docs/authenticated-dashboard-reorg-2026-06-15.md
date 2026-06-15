# Authenticated Dashboard Reorganization

## Hierarchy proposal

Make the authenticated dashboard a user-first recommendation surface, with organizer operations available but visually secondary.

1. **Recommended For You** — primary dashboard module. Show EventReason-ranked upcoming events first so users immediately see where to go next.
2. **See Them Again Soon** — relationship follow-up module. Keep the existing network-driven event opportunity list directly below recommendations.
3. **My Network** — relationship memory module. Move connection inventory below recommendation/action surfaces because it explains the data but is not the primary task.
4. **Organizer tools / Your Events** — management module. Keep event creation and event cards available for organizers, but below discovery for normal signed-in users.

## Implementation plan

- Rename the dashboard hero copy from an organizer-centric “Your Events” page to a recommendation-centric “Recommended For You” page.
- Render `Recommended For You` before network and organizer sections in the authenticated DOM.
- Keep the existing EventReason pipeline by reusing `buildEventDecisionReasons`, `buildKnownAttendeeReason`, and `computeEventDecisionScore` for recommendations and relationship context.
- Add an explicit `Organizer tools` section around the managed event cards so organizer controls are still discoverable without competing with the recommendation surface.
- Increase visual emphasis on the recommendations card and use a dividing rule before organizer tools to clarify hierarchy.

## Mockup

```text
┌────────────────────────────────────────────────────────────┐
│ Recommended For You                         [+ Create Event]│
│ Personalized event picks powered by EventReason             │
├────────────────────────────────────────────────────────────┤
│ EventReason ranked                                         │
│ Recommended For You                                        │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐      │
│ │ Event pick    │ │ Event pick    │ │ Event pick    │      │
│ │ Why this fits │ │ Why this fits │ │ Why this fits │      │
│ │ [View Event]  │ │ [View Event]  │ │ [View Event]  │      │
│ └───────────────┘ └───────────────┘ └───────────────┘      │
├────────────────────────────────────────────────────────────┤
│ Upcoming with your network                                 │
│ See them again soon                                        │
├────────────────────────────────────────────────────────────┤
│ Relationship memory                                        │
│ My Network                                                 │
├────────────────────────────────────────────────────────────┤
│ Organizer tools                                            │
│ Your Events                                                │
│ ┌───────────────┐ ┌───────────────┐                        │
│ │ Manage event  │ │ Manage event  │                        │
│ └───────────────┘ └───────────────┘                        │
└────────────────────────────────────────────────────────────┘
```
