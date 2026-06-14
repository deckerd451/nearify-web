/**
 * Canonical intent values for Nearify.
 *
 * These are the ONLY values that may be written to event_attendees.intent_primary
 * or passed to computeIntentAlignment / normalizeIntent. Adding a new intent
 * requires updating this list, the EL complementary matrix, and any HTML chips
 * that expose it. Do not define intent enums elsewhere.
 */

export const VALID_INTENTS = [
  "meet_people",
  "find_cofounder",
  "hire",
  "explore_ideas",
  "demo",
  "demo_something",
];

/**
 * Display labels for intent values. Suitable for UI and analytics.
 * "demo" and "demo_something" intentionally share a label — they are aliases.
 */
export const INTENT_LABELS = {
  meet_people:    "Meet people",
  find_cofounder: "Find a cofounder",
  hire:           "Hire",
  explore_ideas:  "Explore ideas",
  demo:           "Demo something",
  demo_something: "Demo something",
};

export function isKnownIntent(intent) {
  return VALID_INTENTS.includes(String(intent ?? "").trim().toLowerCase());
}
