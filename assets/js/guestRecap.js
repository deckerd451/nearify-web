/**
 * guestRecap.js — the text a guest copies with "Copy my recap".
 *
 * Built only from what the guest already sees: the names they saved, when
 * they saved them, and the private memories kept on this device. No links,
 * QR codes, ids or tokens are ever included.
 */

function formatSavedOn(value, locale) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/**
 * @param {{ eventName?: string, people: { name: string, savedAt?: string, memory?: string }[], locale?: string }} input
 * @returns {string} plain text, or "" when there is no one to list
 */
export function buildGuestRecap({ eventName, people, locale } = {}) {
  const seen = new Set();
  const lines = [];
  for (const person of people || []) {
    const name = typeof person?.name === "string" ? person.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const savedOn = formatSavedOn(person.savedAt, locale);
    lines.push(savedOn ? `${name} (saved ${savedOn})` : name);
    const memory = typeof person.memory === "string" ? person.memory.trim() : "";
    if (memory) lines.push(...memory.split(/\r?\n/).map((line) => "  " + line.trim()).filter((line) => line.trim()));
    lines.push("");
  }
  if (!seen.size) return "";
  const title = eventName && eventName.trim() ? `People I met at ${eventName.trim()}` : "People I met";
  return [title, "", ...lines, "Saved with Nearify"].join("\n");
}
