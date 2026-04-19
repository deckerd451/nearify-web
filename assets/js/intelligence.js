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

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str ?? "");
  return d.innerHTML;
}

/**
 * Build the event context header shown at the top of every intelligence section.
 * Includes event name, date, and a live/pending status badge.
 */
function buildEventHeader(eventMeta, hasData) {
  const header = document.createElement("div");
  header.className = "intel-event-header";

  const datePart = eventMeta.date
    ? `<span class="intel-event-date"> · ${escapeHtml(eventMeta.date)}</span>`
    : "";

  const statusClass = hasData ? "intel-status-ready"   : "intel-status-pending";
  const statusText  = hasData ? "Ready"                : "Report pending";

  header.innerHTML =
    `<div class="intel-event-badge">` +
      `<span class="intel-event-name">${escapeHtml(eventMeta.name)}</span>` +
      datePart +
    `</div>` +
    `<div class="intel-report-status ${statusClass}">` +
      `<span class="intel-status-dot"></span>` +
      `<span class="intel-status-text">${statusText}</span>` +
    `</div>`;

  return header;
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
    ? `<img class="intel-avatar" src="${escapeHtml(item.target_avatar)}" alt="${escapeHtml(initials)}" />`
    : `<div class="intel-avatar intel-avatar-placeholder" aria-hidden="true">${escapeHtml(initials)}</div>`;

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
      <div class="intel-card-name">${escapeHtml(item.target_name || "Attendee")}</div>
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
  console.log("[Intelligence] Requesting get_my_intelligence for event:", eventId);

  const { data, error } = await supabase.rpc("get_my_intelligence", {
    p_event_id: eventId,
  });

  if (error) {
    console.error("[Intelligence] load error:", error);
    return null;
  }

  console.log("[Intelligence] rows returned:", data ? data.length : 0);
  console.log("[Intelligence] payload type:", Array.isArray(data) ? "array" : typeof data);
  return data;
}

/**
 * Fetch event metadata (name, date) for display in intelligence sections.
 * @param {string} eventId
 * @returns {Promise<{name:string, date:string|null}|null>}
 */
export async function fetchEventMeta(eventId) {
  if (!eventId) return null;
  try {
    const { data, error } = await supabase
      .from("events")
      .select("name, starts_at")
      .eq("id", eventId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      name: data.name,
      date: data.starts_at
        ? new Date(data.starts_at).toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric"
          })
        : null,
    };
  } catch {
    return null;
  }
}

/**
 * Render intelligence data into a container element.
 *
 * @param {HTMLElement}      container
 * @param {Array|null}       data       - rows from fetchIntelligence
 * @param {{name,date}|null} eventMeta  - from fetchEventMeta; shown in header + empty state
 */
export function renderIntelligenceInto(container, data, eventMeta = null) {
  container.innerHTML = "";

  const hasData = !!(data && data.length > 0);

  // Event header — always shown when we know which event this is
  if (eventMeta) {
    container.appendChild(buildEventHeader(eventMeta, hasData));
  }

  if (!hasData) {
    const eventLine = eventMeta
      ? `Interaction data from <strong>${escapeHtml(eventMeta.name)}</strong> is being processed.`
      : "Your interaction data is being processed.";

    const empty = document.createElement("div");
    empty.className = "intel-empty";
    empty.innerHTML =
      `<p class="intel-empty-title">Your post-event report is being prepared.</p>` +
      `<p class="intel-empty-body">${eventLine} ` +
      `Reports are typically ready within a few hours of the event ending.</p>` +
      `<button class="intel-refresh-btn" onclick="window.location.reload()">Refresh to check</button>`;
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
    const eventLine = eventMeta
      ? `Interaction data from <strong>${escapeHtml(eventMeta.name)}</strong> is being processed.`
      : "Your interaction data is being processed.";
    const empty = document.createElement("div");
    empty.className = "intel-empty";
    empty.innerHTML =
      `<p class="intel-empty-title">Your post-event report is being prepared.</p>` +
      `<p class="intel-empty-body">${eventLine} ` +
      `Reports are typically ready within a few hours of the event ending.</p>` +
      `<button class="intel-refresh-btn" onclick="window.location.reload()">Refresh to check</button>`;
    container.appendChild(empty);
  }

  container.style.display = "";
}
