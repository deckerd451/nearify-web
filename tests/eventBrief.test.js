import { describe, expect, it } from 'vitest';
import { buildEventBrief, briefLine, isBriefWindow, whenLabel } from '../assets/js/eventBrief.js';

const now = new Date('2026-11-18T15:00:00');
const connections = [
  { profile_id: 'a', name: 'Maya Rivera', first_encounter_event_name: 'Show & Tell', last_encounter_at: '2026-10-01T00:00:00Z' },
  { profile_id: 'b', name: 'Jordan Price', first_encounter_event_name: 'TechYeet', last_encounter_at: '2026-11-10T00:00:00Z' },
  { profile_id: 'c', name: 'Priya Shah', first_encounter_event_name: '', last_encounter_at: '2026-11-12T00:00:00Z' },
  { profile_id: 'd', name: 'Snoozed Sam', first_encounter_event_name: 'X', last_encounter_at: '2026-11-15T00:00:00Z' },
];
const contexts = [
  { profile_id: 'a', note: 'Flood alert bot', intention: 'Ask how the launch went', intention_completed: false },
  { profile_id: 'b', note: 'Wants beta testers', intention: 'Done thing', intention_completed: true },
  { profile_id: 'd', note: 'Hidden for now', intention: 'x', snoozed_until: '2026-12-01T00:00:00Z' },
];
const handSaved = [
  { id: 'h1', name: 'Alex Kim', where: 'coffee', note: 'Hiring a designer', savedAt: '2026-11-17T00:00:00Z' },
  { id: 'h2', name: 'No Note', where: 'coffee', note: '', savedAt: '2026-11-17T00:00:00Z' },
  { id: 'h3', name: 'maya rivera', where: 'dup', note: 'dup', savedAt: '2026-11-17T00:00:00Z' },
];

describe('people you might see', () => {
  const { people, total } = buildEventBrief({ connections, contexts, handSaved, now });

  it('puts what you meant to ask first, then notes, then recent', () => {
    expect(people.map((p) => p.name)).toEqual(['Maya Rivera', 'Jordan Price', 'Alex Kim', 'Snoozed Sam', 'Priya Shah']);
    expect(total).toBe(5);
  });

  it('uses your intention unless it is done, and hides snoozed notes', () => {
    expect(briefLine(people[0])).toBe('Next time: Ask how the launch went');
    expect(briefLine(people.find((p) => p.name === 'Jordan Price'))).toBe('Wants beta testers');
    expect(briefLine(people.find((p) => p.name === 'Snoozed Sam'))).toBe('');
  });

  it('includes hand-saved people only with a note, never twice', () => {
    expect(people.find((p) => p.name === 'Alex Kim')).toMatchObject({ metAt: 'Met: coffee', href: '/handshake/' });
    expect(people.some((p) => p.name === 'No Note' || p.name === 'maya rivera')).toBe(false);
  });

  it('links members to their profile and respects the limit', () => {
    expect(people[0].href).toBe('/profile/a?from=connections');
    expect(buildEventBrief({ connections, contexts, handSaved, now, limit: 2 }).people).toHaveLength(2);
    expect(buildEventBrief().people).toEqual([]);
  });
});

describe('when to brief', () => {
  it('opens 36 hours before and closes when the event ends', () => {
    expect(isBriefWindow({ starts_at: '2026-11-19T22:00:00' }, { now })).toBe(true);
    expect(isBriefWindow({ starts_at: '2026-11-21T22:00:00' }, { now })).toBe(false);
    expect(isBriefWindow({ starts_at: '2026-11-18T13:00:00', ends_at: '2026-11-18T16:00:00' }, { now })).toBe(true);
    expect(isBriefWindow({ starts_at: '2026-11-18T10:00:00', ends_at: '2026-11-18T12:00:00' }, { now })).toBe(false);
    expect(isBriefWindow({}, { now })).toBe(false);
  });

  it('labels the day', () => {
    expect(whenLabel('2026-11-18T19:00:00', now)).toBe('Tonight');
    expect(whenLabel('2026-11-18T16:00:00', now)).toBe('Today');
    expect(whenLabel('2026-11-19T17:00:00', now)).toBe('Tomorrow');
    expect(whenLabel('2026-11-18T14:00:00', now)).toBe('Happening now');
  });
});

import { buildEventShareUrl } from '../assets/js/share.js';
describe('event links', () => {
  it('uses ?id= when an event has no slug', () => {
    expect(buildEventShareUrl({ id: 'abc', slug: null })).toBe('https://nearify.org/events/event.html?id=abc&web=1');
    expect(buildEventShareUrl({ id: 'abc', slug: 'show-and-tell' })).toBe('https://nearify.org/events/event.html?slug=show-and-tell&web=1');
  });
});
