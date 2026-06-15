# EventReason-Based Event Ranking

## Current ordering audit

- The normal dashboard event list stays chronological by status: live events first, upcoming events by soonest start time, and ended events by the existing recency/participation relevance score.
- Recommended For You previously sorted eligible upcoming events by the highest single EventReason `rank`, then start time and name.
- Upcoming With Your Network previously sorted matching attendee rows by event start time first, then relationship encounter depth and recency. Multiple network attendees at the same event could also produce duplicate event rows.

## Ranking formula

For personalized recommendation surfaces, Nearify now computes an Event Decision Score from existing EventReason data only:

```text
event_score =
  max(reason.score or reason.rank) * 0.65
  + avg(top 3 reason scores) * 0.25
  + live/urgency boost * 0.10
```

The live/urgency boost uses only existing event timing fields:

- 100: event is live now.
- 70: starts within 24 hours.
- 40: starts within 72 hours.
- 20: starts within 7 days.
- 0: otherwise.

## Before / after examples

### Recommended For You

Before, Event A with one very high reason could outrank Event B even if Event B had several strong supporting reasons. After, the strongest reason still matters most, but the average of the top three reasons lets multi-signal events rise.

Example:

- Event A reasons: `[170]`, not urgent → `170*0.65 + 170*0.25 + 0 = 153.0`
- Event B reasons: `[150, 60, 50]`, starts within 24h → `150*0.65 + 86.7*0.25 + 70*0.10 = 126.2`

Event A still wins because the top reason is much stronger. If Event B is live, its score becomes `129.2`; if its top reason grows, it can overtake without relying on date alone.

### Upcoming With Your Network

Before, a soon event with one weak network attendee could appear above a later event with several stronger EventReasons. After, network opportunities are grouped by event and ranked by Event Decision Score, with start time used only as a tie-breaker.
