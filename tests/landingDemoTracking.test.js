import { describe, expect, it, vi } from 'vitest';
import { LANDING_DEMO_EVENTS, analyticsTracker, createOnceTracker } from '../assets/js/landingDemoTracking.js';

describe('landing demo counts', () => {
  it('sends each step at most once, with only the event name', () => {
    const track = vi.fn();
    const once = createOnceTracker(track);
    once(LANDING_DEMO_EVENTS.started);
    once(LANDING_DEMO_EVENTS.started);
    once(LANDING_DEMO_EVENTS.completed);
    expect(track.mock.calls).toEqual([['landing_demo_started'], ['landing_demo_completed']]);
  });

  it('never lets a tracking failure reach the demo', async () => {
    const once = createOnceTracker(() => { throw Error('boom'); });
    expect(() => once(LANDING_DEMO_EVENTS.view)).not.toThrow();
    const failingLoad = analyticsTracker(() => Promise.reject(Error('offline')));
    expect(() => failingLoad('landing_view')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('passes no properties to analytics', async () => {
    const trackFunnelEvent = vi.fn();
    analyticsTracker(() => Promise.resolve({ trackFunnelEvent }))('landing_demo_completed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trackFunnelEvent).toHaveBeenCalledWith('landing_demo_completed');
  });

  it('uses the names the admin report counts', () => {
    expect(Object.values(LANDING_DEMO_EVENTS).sort()).toEqual([
      'landing_demo_completed', 'landing_demo_cta_clicked', 'landing_demo_started', 'landing_try_clicked', 'landing_view',
    ]);
  });
});
