/**
 * landingDemoTracking.js — anonymous counts for the signed-out homepage demo.
 *
 * Each step is counted at most once per page load and carries no properties:
 * never the visitor's note, never an identity. Counts answer one question:
 * of the people who see the homepage, how many try the demo and finish it?
 */

export const LANDING_DEMO_EVENTS = Object.freeze({
  view: "landing_view",                  // signed-out homepage was shown
  tryClicked: "landing_try_clicked",     // hero "Try it in 30 seconds"
  started: "landing_demo_started",       // step 1: "Save Maya"
  completed: "landing_demo_completed",   // reached step 3, the reminder
  ctaClicked: "landing_demo_cta_clicked", // "Save a real person" after the demo
});

/** Wraps a tracker so each event name is sent at most once, with no properties. */
export function createOnceTracker(track) {
  const sent = new Set();
  return function trackOnce(eventName) {
    if (sent.has(eventName)) return;
    sent.add(eventName);
    try {
      track(eventName);
    } catch (_) {
      // Counting is best effort; the demo never depends on it.
    }
  };
}

/** Loads analytics lazily, so the demo still works if analytics fails to load. */
export function analyticsTracker(load = () => import("./analytics.js")) {
  return function track(eventName) {
    load()
      .then((mod) => mod.trackFunnelEvent(eventName))
      .catch(() => {});
  };
}
