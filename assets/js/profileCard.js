/**
 * profileCard.js — a person's "Building" and "Looking for" lines.
 *
 * Both are optional, written by the person about themselves, and shown on
 * their card to anyone with their QR link. Everything here degrades quietly:
 * if the database hasn't been migrated yet, cards look exactly as before.
 */

export const CARD_FIELD_MAX = 120;

export const CARD_FIELDS = Object.freeze([
  { key: "building", label: "Building" },
  { key: "looking_for", label: "Looking for" },
]);

/** Trims, collapses whitespace and caps a card line; empty becomes null. */
export function cleanCardText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, CARD_FIELD_MAX).trim();
  return text || null;
}

/** Returns only the card lines that have text, in display order. */
export function cardFacts(profile) {
  if (!profile) return [];
  return CARD_FIELDS
    .map((field) => ({ ...field, value: cleanCardText(profile[field.key]) }))
    .filter((fact) => fact.value);
}

/** Fetches another person's shared card lines. Returns null when unavailable. */
export async function fetchProfileCard(supabase, profileId) {
  if (!profileId) return null;
  try {
    const { data, error } = await supabase
      .rpc("get_public_profile_card", { p_profile_id: profileId })
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (_) {
    return null;
  }
}

/**
 * Fills a <dl> with the card lines and reveals it, or keeps it hidden when
 * there's nothing to show. Uses textContent only.
 */
export function renderCardFacts(dl, profile, doc = globalThis.document) {
  if (!dl) return;
  const facts = cardFacts(profile);
  dl.replaceChildren();
  for (const fact of facts) {
    const row = doc.createElement("div");
    const dt = doc.createElement("dt");
    dt.textContent = fact.label;
    const dd = doc.createElement("dd");
    dd.textContent = fact.value;
    row.append(dt, dd);
    dl.append(row);
  }
  dl.hidden = facts.length === 0;
}
