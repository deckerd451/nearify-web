/**
 * home.js — Homepage state-aware behavior
 *
 * Detects auth state and event context, then renders the appropriate
 * homepage state: anonymous, in-event, or post-event intelligence.
 */
import { supabase } from "./supabaseClient.js";
import { getCurrentUser, getCurrentEventId } from "./appState.js";
import { fetchIntelligence, renderIntelligenceInto } from "./intelligence.js";

const TESTFLIGHT_URL = "https://testflight.apple.com/join/ZayvEbAy";

// DOM refs — these elements are added to index.html
const heroActions    = document.getElementById("heroActions");
const yourEvent      = document.getElementById("yourEventSection");
const yourEventBody  = document.getElementById("yourEventBody");
const intelSection   = document.getElementById("homeIntelSection");
const intelContainer = document.getElementById("homeIntelContainer");

async function init() {
  const user = await getCurrentUser();
  const eventId = getCurrentEventId();

  if (!user) {
    // STATE: anonymous — default hero is already correct
    console.log("[Home] Not signed in — showing default state");
    return;
  }

  console.log("[Home] Signed in as:", user.email);

  if (eventId) {
    // STATE B or C — user has an event in context
    showEventState(eventId, user);
    await loadHomeIntelligence(eventId);
  } else {
    // STATE A — signed in but no event
    console.log("[Home] Signed in, no current event");
  }
}

function showEventState(eventId, user) {
  if (!yourEvent || !yourEventBody) return;

  const deepLink = `beacon://event/${eventId}`;

  yourEventBody.innerHTML = `
    <div class="event-meta-card" style="display:inline-block; margin-bottom:16px;">
      <div class="meta-label">Current event</div>
      <div class="meta-value" style="font-size:14px; overflow-wrap:anywhere;">${eventId}</div>
    </div>
    <div class="hero-actions">
      <a href="${deepLink}" class="btn primary">Open Nearify</a>
      <a href="join/?event=${encodeURIComponent(eventId)}" class="btn secondary">Event join page</a>
    </div>
  `;

  yourEvent.style.display = "";
}

async function loadHomeIntelligence(eventId) {
  if (!intelSection || !intelContainer) return;

  const data = await fetchIntelligence(eventId);
  if (!data || data.length === 0) {
    console.log("[Home] No intelligence for event", eventId);
    return;
  }

  renderIntelligenceInto(intelContainer, data);
  intelSection.style.display = "";
}

init().catch((err) => console.error("[Home] init failed:", err));
