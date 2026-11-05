import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../assets/js/analytics.js?v=20261105-funnel1', () => ({ trackFunnelEvent: vi.fn() }));
import { trackFunnelEvent } from '../assets/js/analytics.js?v=20261105-funnel1';
let track;
beforeEach(async () => {
  vi.resetModules();
  vi.mocked(trackFunnelEvent).mockReset();
  const values = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  let id = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `12345678-1234-4234-8234-${String(++id).padStart(12,'0')}` });
  ({ trackGuestFunnel: track } = await import('../assets/js/guestFunnel.js'));
});
afterEach(() => vi.unstubAllGlobals());
describe('guest activation measurement', () => {
  it('correlates stages for one event and separates different event journeys', () => {
    track('guest_join_viewed','event-a');
    track('guest_connection_saved','event-a',{method:'camera',connection_kind:'guest'});
    track('guest_join_viewed','event-b');
    const calls = vi.mocked(trackFunnelEvent).mock.calls;
    expect(calls[0][1].journey_id).toBe(calls[1][1].journey_id);
    expect(calls[0][1].journey_id).not.toBe(calls[2][1].journey_id);
  });
  it('excludes QR values, identities, tokens, raw errors and referrers', () => {
    track('guest_connection_save_failed','event-a',{
      method:'camera',reason:'request_failed',decoder:'jsqr',
      name:'Alex',ghost_token:'private-token',qr:'https://nearify.org/?guest=secret',
      error:'private server details',referrer:'https://nearify.org/?token=secret',
    });
    expect(trackFunnelEvent).toHaveBeenCalledWith('guest_connection_save_failed', {
      eventId:'event-a',referrer:'',journey_id:expect.any(String),method:'camera',reason:'request_failed',decoder:'jsqr',
    });
  });
  it('counts a page stage once per tab/event, including a module reload', async () => {
    track('guest_join_viewed','event-a',{}, {once:true});
    vi.resetModules();
    const { trackGuestFunnel: afterReload } = await import('../assets/js/guestFunnel.js');
    afterReload('guest_join_viewed','event-a',{}, {once:true});
    afterReload('guest_join_viewed','event-b',{}, {once:true});
    expect(trackFunnelEvent).toHaveBeenCalledTimes(2);
  });
  it('ignores unknown event names and unapproved property values', () => {
    track('arbitrary_private_event','event-a');
    track('guest_scan_failed','event-a',{reason:'raw private message',method:'https://secret'});
    expect(trackFunnelEvent).toHaveBeenCalledTimes(1);
    expect(trackFunnelEvent.mock.calls[0][1]).not.toHaveProperty('reason');
    expect(trackFunnelEvent.mock.calls[0][1]).not.toHaveProperty('method');
  });
  it('does not interrupt the workflow when storage or tracking is unavailable', () => {
    vi.stubGlobal('sessionStorage',{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});
    vi.mocked(trackFunnelEvent).mockImplementation(()=>{throw Error('offline');});
    expect(()=>track('guest_connection_saved','event-a')).not.toThrow();
  });
});
