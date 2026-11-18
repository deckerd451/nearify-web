import { describe, expect, it, vi } from 'vitest';
import { CARD_FIELD_MAX, cardFacts, cleanCardText, fetchProfileCard, renderCardFacts } from '../assets/js/profileCard.js';

describe('profile card lines', () => {
  it('trims, collapses whitespace, caps length and drops empty lines', () => {
    expect(cleanCardText('  A  tide\n alert ')).toBe('A tide alert');
    expect(cleanCardText('   ')).toBeNull();
    expect(cleanCardText(null)).toBeNull();
    expect(cleanCardText('x'.repeat(200))).toHaveLength(CARD_FIELD_MAX);
  });

  it('lists only lines with text, Building first', () => {
    expect(cardFacts({ looking_for: 'A designer', building: '' })).toEqual([
      { key: 'looking_for', label: 'Looking for', value: 'A designer' },
    ]);
    expect(cardFacts({ building: 'Bot', looking_for: 'Designer' }).map((f) => f.label)).toEqual(['Building', 'Looking for']);
    expect(cardFacts(null)).toEqual([]);
  });

  it('returns null instead of throwing when the card function is missing', async () => {
    const missing = { rpc: () => ({ maybeSingle: async () => ({ data: null, error: { code: 'PGRST202' } }) }) };
    expect(await fetchProfileCard(missing, 'id')).toBeNull();
    const broken = { rpc: () => { throw Error('offline'); } };
    expect(await fetchProfileCard(broken, 'id')).toBeNull();
    expect(await fetchProfileCard(missing, null)).toBeNull();
  });

  it('renders text safely and hides an empty card', () => {
    const made = [];
    const doc = { createElement: (tag) => { const n = { tag, children: [], append(...c) { this.children.push(...c); } }; made.push(n); return n; } };
    const dl = { hidden: true, children: [], replaceChildren() { this.children = []; }, append(c) { this.children.push(c); } };
    renderCardFacts(dl, { building: '<img src=x onerror=alert(1)>' }, doc);
    expect(dl.hidden).toBe(false);
    expect(dl.children[0].children[1].textContent).toBe('<img src=x onerror=alert(1)>');
    expect(made.some((n) => 'innerHTML' in n)).toBe(false);
    renderCardFacts(dl, {}, doc);
    expect(dl.hidden).toBe(true);
  });
});
