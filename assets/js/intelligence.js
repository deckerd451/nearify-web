/**
 * intelligence.js — Shared intelligence rendering module
 *
 * Reusable across join page, homepage, and any future page that
 * needs to display post-event intelligence cards.
 */
import { supabase } from "./supabaseClient.js";
import { getCurrentUser } from "./appState.js";

const DIRECTION_LABELS = {
  incoming: "They noticed you",
  outgoing: "You connected",
};

const STRENGTH_LEVELS = [
  { min: 75, dots: 3, label: "Strong match" },
  { min: 45, dots: 2, label: "Good signal"  },
  { min:  0, dots: 1, label: "Mild signal"  },
];

function scoreToStrength(score) {
  return STRENGTH_LEVELS.find(l => score >= l.min) ?? STRENGTH_LEVELS[2];
}

function renderStrengthDots(dots) {
  return [1, 2, 3].map(i =>
    `<span class="intel-dot ${i <= dots ? "filled" : "empty"}"></span>`
  ).join("");
}

function getInitials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

/**
 * Normalize backend reason text.
 */
function normalizeReason(reason) {
  if (!reason) return "";
  let r = reason.trim()
    .replace(/worth following up/gi, "notable interaction")
    .replace(/\bfollow[\s-]?up\b/gi, "reconnect")
    .replace(/Brief interaction — notable interaction\./gi, "Brief interaction — a signal worth noting.");
  if (!/[.!?]$/.test(r)) r += ".";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/**
 * Render a single intelligence card DOM element.
 */
export function renderIntelCard(item) {
  const card = document.createElement("div");
  card.className = "intel-card";

  const initials = getInitials(item.target_name);
  const avatar = item.target_avatar
    ? `<img class="intel-avatar" src="${item.target_avatar}" alt="${initials}" />`
    : `<div class="intel-avatar intel-avatar-placeholder" aria-hidden="true">${initials}</div>`;

  const directionText = DIRECTION_LABELS[item.direction] ?? "Interaction";
  const directionClass = item.direction === "incoming" ? "incoming" : "outgoing";
  const directionLabel = `<span class="intel-direction ${directionClass}">${directionText}</span>`;

  const strength = scoreToStrength(Math.round(item.score ?? 0));
  const strengthHtml = `
    <div class="intel-strength">
      <span class="intel-dots">${renderStrengthDots(strength.dots)}</span>
      <span class="intel-strength-label">${strength.label}</span>
    </div>`;

  const missedHint = item.type === "missed"
    ? `<p class="intel-missed-hint">You were near each other but didn't connect — worth a reach-out.</p>`
    : "";

  card.innerHTML = `
    ${avatar}
    <div class="intel-card-body">
      <div class="intel-card-name">${item.target_name || "Attendee"}</div>
      ${directionLabel}
      <div class="intel-card-reason">${normalizeReason(item.reason)}</div>
      ${strengthHtml}
      ${missedHint}
    </div>
  `;
  return card;
}

/**
 * Fetch intelligence for the current user at a given event.
 * @param {string} eventId
 * @returns {Promise<Array|null>}
 */
export async function fetchIntelligence(eventId) {
  const user = await getCurrentUser();
  if (!user) return null;

  console.log("[Intelligence] Current user id:", user.id);

  const { data, error } = await supabase.rpc("get_my_intelligence", {
    p_event_id: eventId,
  });

  if (error) {
    console.error("[Intelligence] load error:", error);
    return null;
  }

  console.log("[Intelligence] rows returned:", data ? data.length : 0);
  return data;
}

/**
 * Render intelligence data into a container element.
 */
export function renderIntelligenceInto(container, data) {
  container.innerHTML = "";

  if (!data || data.length === 0) {
    const empty = document.createElement("div");
    empty.className = "intel-empty";
    empty.innerHTML =
      `<p class="intel-empty-title">Your post-event report isn't ready yet.</p>` +
      `<p class="intel-empty-body">Results are prepared within a few hours of the event ending. ` +
      `Make sure you used Nearify during the event — the more interactions, the richer your report.</p>`;
    container.appendChild(empty);
    container.style.display = "";
    return;
  }

  const buckets = {
    recommended: { title: "Strongest interactions", items: [] },
    follow_up:   { title: "People you met",         items: [] },
    missed:      { title: "You missed",             items: [] },
  };

  data.forEach((d) => {
    if (buckets[d.type]) buckets[d.type].items.push(d);
  });

  let hasContent = false;

  for (const [, bucket] of Object.entries(buckets)) {
    if (!bucket.items.length) continue;
    hasContent = true;

    const section = document.createElement("div");
    section.className = "intel-section";

    const title = document.createElement("h3");
    title.className = "intel-section-title";
    title.innerHTML = `${bucket.title} <span class="intel-section-count">${bucket.items.length}</span>`;
    section.appendChild(title);

    const cards = document.createElement("div");
    cards.className = "intel-cards";
    bucket.items.forEach((item) => cards.appendChild(renderIntelCard(item)));
    section.appendChild(cards);

    container.appendChild(section);
  }

  if (!hasContent) {
    const empty = document.createElement("div");
    empty.className = "intel-empty";
    empty.innerHTML =
      `<p class="intel-empty-title">Your post-event report isn't ready yet.</p>` +
      `<p class="intel-empty-body">Results are prepared within a few hours of the event ending. ` +
      `Make sure you used Nearify during the event — the more interactions, the richer your report.</p>`;
    container.appendChild(empty);
  }

  container.style.display = "";
}
