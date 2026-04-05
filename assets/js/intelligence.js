/**
 * intelligence.js — Shared intelligence rendering module
 *
 * Reusable across join page, homepage, and any future page that
 * needs to display post-event intelligence cards.
 */
import { supabase } from "./supabaseClient.js";
import { getCurrentUser } from "./appState.js";

/**
 * Render a single intelligence card DOM element.
 */
export function renderIntelCard(item) {
  const card = document.createElement("div");
  card.className = "intel-card";

  const avatar = item.target_avatar
    ? `<img class="intel-avatar" src="${item.target_avatar}" alt="" />`
    : `<div class="intel-avatar intel-avatar-placeholder"></div>`;

  const directionLabel = item.direction === "incoming"
    ? `<span class="intel-direction incoming">They matched with you</span>`
    : `<span class="intel-direction outgoing">You matched with them</span>`;

  card.innerHTML = `
    ${avatar}
    <div class="intel-card-body">
      <div class="intel-card-name">${item.target_name || "Attendee"}</div>
      ${directionLabel}
      <div class="intel-card-reason">${item.reason || ""}</div>
      <div class="intel-card-score">Score: ${Math.round(item.score)}</div>
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
 *
 * Expects the container to have (or will create) sub-sections for
 * follow_up, missed, and recommended types.
 *
 * @param {HTMLElement} container - parent element to render into
 * @param {Array} data - intelligence rows from fetchIntelligence
 */
export function renderIntelligenceInto(container, data) {
  container.innerHTML = "";

  if (!data || data.length === 0) {
    const empty = document.createElement("p");
    empty.className = "intel-empty";
    empty.textContent = "No intelligence yet. Use Nearify at the event and check back after.";
    container.appendChild(empty);
    container.style.display = "";
    return;
  }

  const buckets = {
    recommended: { title: "Strongest interactions", items: [] },
    follow_up:   { title: "You should follow up with", items: [] },
    missed:      { title: "You missed", items: [] },
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
    title.textContent = bucket.title;
    section.appendChild(title);

    const cards = document.createElement("div");
    cards.className = "intel-cards";
    bucket.items.forEach((item) => cards.appendChild(renderIntelCard(item)));
    section.appendChild(cards);

    container.appendChild(section);
  }

  if (!hasContent) {
    const empty = document.createElement("p");
    empty.className = "intel-empty";
    empty.textContent = "No intelligence yet. Use Nearify at the event and check back after.";
    container.appendChild(empty);
  }

  container.style.display = "";
}
