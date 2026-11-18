import { describe, expect, it } from 'vitest';
import { buildGuestRecap } from '../assets/js/guestRecap.js';

describe('guest recap text', () => {
  it('lists names with dates and indented memories', () => {
    const text = buildGuestRecap({
      eventName: 'Show & Tell',
      locale: 'en-US',
      people: [
        { name: 'Maya Rivera', savedAt: '2026-11-18T23:00:00Z', memory: 'Ask how the launch went\nIntro to Sam' },
        { name: 'Jordan (guest)', savedAt: '2026-11-18T23:30:00Z' },
      ],
    });
    expect(text).toBe([
      'People I met at Show & Tell', '',
      'Maya Rivera (saved Nov 18)', '  Ask how the launch went', '  Intro to Sam', '',
      'Jordan (guest) (saved Nov 18)', '',
      'Saved with Nearify',
    ].join('\n'));
  });

  it('skips blanks and duplicates, and tolerates bad dates', () => {
    const text = buildGuestRecap({ people: [{ name: ' ' }, { name: 'A', savedAt: 'nope' }, { name: 'A' }] });
    expect(text).toBe('People I met\n\nA\n\nSaved with Nearify');
  });

  it('returns nothing when no one was saved', () => {
    expect(buildGuestRecap({ people: [] })).toBe('');
    expect(buildGuestRecap()).toBe('');
  });

  it('never includes links or ids even if passed extra fields', () => {
    const text = buildGuestRecap({ people: [{ name: 'Maya', memoryTargetId: 'abc-123', url: 'https://nearify.org/join/?guest=secret' }] });
    expect(text).not.toMatch(/abc-123|https?:|secret/);
  });
});
