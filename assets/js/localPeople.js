/**
 * localPeople.js — people you saved by hand, without a QR.
 *
 * Signed out, they live only in this browser (localStorage). Signed in, they
 * live in the owner-only private_contacts table, and anything saved on this
 * device first is moved there once. Nearify never contacts these people.
 *
 * Everything here is free of DOM access so it can be tested under Node.
 */

export const LOCAL_PEOPLE_KEY = "nearify_local_people_v1";
export const LIMITS = Object.freeze({ name: 80, where: 120, note: 500 });

function oneLine(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max).trim();
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/** Validates and normalizes a new entry. Returns null without a name. */
export function makePerson({ name, where, note } = {}, now = new Date()) {
  const cleanName = oneLine(name, LIMITS.name);
  if (!cleanName) return null;
  return {
    id: newId(),
    name: cleanName,
    where: oneLine(where, LIMITS.where),
    note: clean(note, LIMITS.note),
    savedAt: now.toISOString(),
  };
}

/** Reads a stored list defensively: bad JSON or bad rows are dropped. */
export function parsePeople(raw) {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    return list.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim())
      .map((p) => ({
        id: p.id,
        name: oneLine(p.name, LIMITS.name),
        where: oneLine(p.where, LIMITS.where),
        note: clean(p.note, LIMITS.note),
        savedAt: typeof p.savedAt === "string" ? p.savedAt : new Date(0).toISOString(),
      }));
  } catch (_) {
    return [];
  }
}

/** Newest first. */
export function sortPeople(list) {
  return [...list].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

/** A store backed by this browser. `storage` is injectable for tests. */
export function createLocalStore(storage = globalThis.localStorage) {
  const read = () => {
    try { return parsePeople(storage.getItem(LOCAL_PEOPLE_KEY)); } catch (_) { return []; }
  };
  const write = (list) => storage.setItem(LOCAL_PEOPLE_KEY, JSON.stringify(list));
  return {
    kind: "device",
    async list() { return sortPeople(read()); },
    async add(person) { write([person, ...read().filter((p) => p.id !== person.id)]); return person; },
    async remove(id) { write(read().filter((p) => p.id !== id)); },
    clear() { try { storage.removeItem(LOCAL_PEOPLE_KEY); } catch (_) { /* nothing to clear */ } },
    peek() { return read(); },
  };
}

/** Converts between the page's shape and the private_contacts row shape. */
export function toRow(person) {
  return { client_id: person.id, name: person.name, met_where: person.where || null, note: person.note || null, saved_at: person.savedAt };
}
export function fromRow(row) {
  return { id: row.client_id, name: row.name, where: row.met_where || "", note: row.note || "", savedAt: row.saved_at };
}

/** A store backed by the signed-in person's private_contacts rows. */
export function createAccountStore(supabase) {
  return {
    kind: "account",
    async list() {
      const { data, error } = await supabase.from("private_contacts")
        .select("client_id, name, met_where, note, saved_at")
        .order("saved_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(fromRow);
    },
    async add(person) {
      const { error } = await supabase.from("private_contacts").upsert(toRow(person), { onConflict: "owner_user_id,client_id" });
      if (error) throw error;
      return person;
    },
    async remove(id) {
      const { error } = await supabase.from("private_contacts").delete().eq("client_id", id);
      if (error) throw error;
    },
    /** Moves device-only people into the account. Safe to repeat. */
    async importAll(people) {
      if (!people.length) return 0;
      const { error } = await supabase.from("private_contacts").upsert(people.map(toRow), { onConflict: "owner_user_id,client_id" });
      if (error) throw error;
      return people.length;
    },
  };
}

// ── Follow-up reminder (.ics) ───────────────────────────────────────────────

function icsText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}
function pad(n) { return String(n).padStart(2, "0"); }
function floating(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}
function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The reminder's start: 10:00 local time, `days` after the day they were saved. */
export function followUpStart(savedAt, days = 7) {
  const base = new Date(savedAt);
  const start = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, 10, 0, 0);
}

/** A one-event calendar file: "Follow up with Maya", 15 minutes, local time. */
export function buildFollowUpIcs(person, { days = 7, now = new Date() } = {}) {
  const start = followUpStart(person.savedAt, days);
  const end = new Date(start.getTime() + 15 * 60000);
  const details = [person.where ? `Met: ${person.where}` : "", person.note ? `Remember: ${person.note}` : ""]
    .filter(Boolean).join("\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nearify//Follow up//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsText(person.id)}@nearify.org`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${floating(start)}`,
    `DTEND:${floating(end)}`,
    `SUMMARY:${icsText("Follow up with " + person.name)}`,
    details ? `DESCRIPTION:${icsText(details)}` : "",
    "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", `DESCRIPTION:${icsText("Follow up with " + person.name)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n") + "\r\n";
}

/** A safe file name for the reminder. */
export function followUpFileName(person) {
  const slug = person.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `follow-up-${slug || "contact"}.ics`;
}
