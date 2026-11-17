/**
 * eventText.js — small text clean-ups for imported event data.
 */

// Imported descriptions sometimes start with the organizer name twice,
// e.g. "CharlestonHacks CharlestonHacks is bringing…". Keep one copy.
export function cleanEventDescription(text) {
  const value = String(text ?? "");
  return value.replace(/^(\s*)((?:\S+\s+){0,4}?\S+)\s+\2(?=\s|$)/u, "$1$2");
}

export function withCleanDescription(event) {
  if (!event || typeof event.description !== "string") return event;
  return { ...event, description: cleanEventDescription(event.description) };
}
