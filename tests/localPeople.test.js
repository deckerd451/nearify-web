import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_PEOPLE_KEY, buildFollowUpIcs, createAccountStore, createLocalStore, followUpFileName,
  followUpStart, fromRow, makePerson, parsePeople, toRow,
} from '../assets/js/localPeople.js';

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

describe('making a person', () => {
  it('needs a name, trims and caps fields', () => {
    expect(makePerson({ name: '   ' })).toBeNull();
    const p = makePerson({ name: '  Maya \n Rivera ', where: ' coffee ', note: 'a'.repeat(600) }, new Date('2026-11-18T15:00:00Z'));
    expect(p.name).toBe('Maya Rivera');
    expect(p.where).toBe('coffee');
    expect(p.note).toHaveLength(500);
    expect(p.savedAt).toBe('2026-11-18T15:00:00.000Z');
    expect(p.id).toMatch(/\S{8,}/);
  });

  it('drops bad stored rows instead of failing', () => {
    expect(parsePeople('not json')).toEqual([]);
    expect(parsePeople('{"a":1}')).toEqual([]);
    expect(parsePeople(JSON.stringify([{ id: 'x', name: 'A' }, { name: 'no id' }, null]))).toHaveLength(1);
  });
});

describe('device store', () => {
  it('adds newest first, removes and clears', async () => {
    const storage = memoryStorage();
    const store = createLocalStore(storage);
    await store.add({ id: '1', name: 'A', where: '', note: '', savedAt: '2026-11-01T00:00:00Z' });
    await store.add({ id: '2', name: 'B', where: '', note: '', savedAt: '2026-11-02T00:00:00Z' });
    expect((await store.list()).map((p) => p.name)).toEqual(['B', 'A']);
    await store.remove('2');
    expect((await store.list()).map((p) => p.id)).toEqual(['1']);
    store.clear();
    expect(storage.getItem(LOCAL_PEOPLE_KEY)).toBeNull();
  });
});

describe('account store', () => {
  it('maps rows both ways and upserts on the owner + client id', async () => {
    const person = { id: 'c1', name: 'Maya', where: '', reach: '', note: 'launch', savedAt: '2026-11-18T15:00:00Z' };
    expect(toRow(person)).toEqual({ client_id: 'c1', name: 'Maya', met_where: null, note: 'launch', saved_at: '2026-11-18T15:00:00Z', reach: null });
    expect(toRow(person, { withReach: false })).not.toHaveProperty('reach');
    expect(fromRow(toRow(person))).toEqual(person);
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const store = createAccountStore({ from: () => ({ upsert }) });
    expect(await store.importAll([person, { ...person, id: 'c2' }])).toBe(2);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'owner_user_id,client_id' });
    expect(await store.importAll([])).toBe(0);
  });

  it('keeps working before the reach column exists', async () => {
    const sent = [];
    const upsert = vi.fn(async (rows) => { sent.push(rows); return sent.length === 1 ? { error: { code: 'PGRST204', message: "Could not find the 'reach' column" } } : { error: null }; });
    const store = createAccountStore({ from: () => ({ upsert }) });
    await store.add({ id: 'c1', name: 'A', reach: '555-123-4567', savedAt: 'x' });
    expect(sent[0][0]).toHaveProperty('reach', '555-123-4567');
    expect(sent[1][0]).not.toHaveProperty('reach');
    expect(store.storesReach).toBe(false);
  });

  it('surfaces errors so the page can fall back to this device', async () => {
    const store = createAccountStore({ from: () => ({ upsert: async () => ({ error: { code: '42P01' } }) }) });
    await expect(store.add({ id: 'c1', name: 'A', savedAt: 'x' })).rejects.toEqual({ code: '42P01' });
  });
});

describe('follow-up reminder', () => {
  const person = { id: 'abc', name: 'Maya, the mapper', where: 'Coffee; King St', note: 'Ask about\nthe launch', savedAt: '2026-11-18T15:00:00' };

  it('starts at 10am local, a week after the save day', () => {
    const start = followUpStart(person.savedAt);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 10, 25, 10]);
  });

  it('is a valid one-event calendar with escaped text', () => {
    const ics = buildFollowUpIcs(person, { now: new Date('2026-11-18T15:00:00Z') });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261125T100000\r\n');
    expect(ics).toContain('DTEND:20261125T101500\r\n');
    expect(ics).toContain('SUMMARY:Follow up with Maya\\, the mapper\r\n');
    expect(ics).toContain('DESCRIPTION:Met: Coffee\\; King St\\nRemember: Ask about\\nthe launch\r\n');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('makes a safe file name', () => {
    expect(followUpFileName(person)).toBe('follow-up-maya-the-mapper.ics');
    expect(followUpFileName({ name: '李' })).toBe('follow-up-contact.ics');
  });
});
