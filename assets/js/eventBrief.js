/**
 * eventBrief.js — "People you might see": a short brief before an event.
 *
 * Built only from the signed-in person's own data: people they connected
 * with, their private notes and "next time" intentions, and people they
 * saved by hand. It never reads who is attending, so it says "might see",
 * never "is going". Pure functions; no DOM or network access.
 */

export const BRIEF_LIMIT = 5;

function text(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function time(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * @param {object} input
 * @param {Array}  input.connections  get_my_connections rows: { profile_id, name, first_encounter_event_name, last_encounter_at }
 * @param {Array}  input.contexts     ambient_contexts rows: { profile_id, note, intention, intention_completed, snoozed_until }
 * @param {Array}  input.handSaved    people saved by hand (account notes): { id, name, where, note, savedAt }
 * @param {number} [input.limit]
 * @param {Date}   [input.now]
 * @returns {{ people: Array<{ key, name, metAt, ask, note, href, score }>, total: number }}
 */
export function buildEventBrief({ connections = [], contexts = [], handSaved = [], limit = BRIEF_LIMIT, now = new Date() } = {}) {
  const contextById = new Map();
  for (const c of contexts || []) {
    if (!c?.profile_id) continue;
    if (c.snoozed_until && time(c.snoozed_until) > now.getTime()) continue;
    contextById.set(c.profile_id, c);
  }

  const people = [];
  const seenNames = new Set();

  for (const conn of connections || []) {
    const name = text(conn?.name);
    if (!conn?.profile_id || !name) continue;
    const ctx = contextById.get(conn.profile_id);
    const ask = ctx && !ctx.intention_completed ? text(ctx.intention) : "";
    const note = ctx ? text(ctx.note) : "";
    const metAt = text(conn.first_encounter_event_name);
    people.push({
      key: "member:" + conn.profile_id,
      name,
      metAt: metAt ? `Met at ${metAt}` : "",
      ask,
      note,
      href: `/profile/${encodeURIComponent(conn.profile_id)}?from=connections`,
      score: (ask ? 3 : 0) + (note ? 2 : 0) + (metAt ? 0.5 : 0),
      recency: time(conn.last_encounter_at),
    });
    seenNames.add(name.toLowerCase());
  }

  for (const person of handSaved || []) {
    const name = text(person?.name);
    const note = text(person?.note);
    // Hand-saved people only earn a place when there's something to say.
    if (!name || !note || seenNames.has(name.toLowerCase())) continue;
    const where = text(person.where);
    people.push({
      key: "hand:" + person.id,
      name,
      metAt: where ? `Met: ${where}` : "",
      ask: "",
      note,
      href: "/handshake/",
      score: 2,
      recency: time(person.savedAt),
    });
  }

  people.sort((a, b) => b.score - a.score || b.recency - a.recency || a.name.localeCompare(b.name));
  return {
    people: people.slice(0, limit).map(({ recency, ...rest }) => rest),
    total: people.length,
  };
}

/** The one line shown under a name: what you meant to ask, else your note. */
export function briefLine(person) {
  if (person.ask) return `Next time: ${person.ask}`;
  return person.note || "";
}

/** Whether an attended event is close enough to brief for. */
export function isBriefWindow(event, { now = new Date(), hoursAhead = 36 } = {}) {
  const start = time(event?.starts_at);
  if (!start) return false;
  const end = time(event?.ends_at) || start + 3 * 3600000;
  const n = now.getTime();
  return end > n && start - n <= hoursAhead * 3600000;
}

/** "Tonight", "Tomorrow", or a weekday, in the viewer's time zone. */
export function whenLabel(startsAt, now = new Date()) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "";
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(start) - day(now)) / 86400000);
  if (start.getTime() <= now.getTime()) return "Happening now";
  if (diff === 0) return start.getHours() >= 17 ? "Tonight" : "Today";
  if (diff === 1) return "Tomorrow";
  return start.toLocaleDateString(undefined, { weekday: "long" });
}
