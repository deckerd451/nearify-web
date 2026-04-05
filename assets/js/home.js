/**
 * home.js — Homepage state-aware behavior
 *
 * - Loads public events from Supabase (for all visitors)
 * - Detects auth state and event context for signed-in users
 * - Surfaces post-event intelligence when available
 */
import { supabase } from "./supabaseClient.js";
import { getCurrentUser, getCurrentEventId } from "./appState.js";
import { fetchIntelligence, renderIntelligenceInto } from "./intelligence.js";
import { fetchPublicEvents } from "./events.js";

const TESTFLIGHT_URL = "https://testflight.apple.com/join/ZayvEbAy";

// DOM refs
const publicEventsList = document.getElementById("publicEventsList");
const yourEvent        = document.getElementById("yourEventSection");
const yourEventBody    = document.getElementById("yourEventBody");
const intelSection     = document.getElementById("homeIntelSection");
const intelContainer   = document.getElementById("homeIntelContainer");

async function init() {
  // Always load public events — no auth needed
  await loadPublicEvents();

  const user = await getCurrentUser();
  const eventId = getCurrentEventId();

  if (!user) {
    console.log("[Home] Not signed in — public mode");
    return;
  }

  console.log("[Home] Signed in as:", user.email);

  if (eventId) {
    showEventState(eventId);
    await loadHomeIntelligence(eventId);
  }
}

async function loadPublicEvents() {
  if (!publicEventsList) return;

  const events = await fetchPublicEvents();

  if (!events.length) {
    publicEventsList.innerHTML =
      '<p class="home-intel-subhead">No events yet. Check back soon.</p>';
    return;
  }

  publicEventsList.innerHTML = events.map(ev => {
    const joinUrl = "join/?event=" + encodeURIComponent(ev.id) +
      "&name=" + encodeURIComponent(ev.name);
    const dateStr = ev.starts_at
      ? new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : "";
    const meta = [ev.location, dateStr].filter(Boolean).join(" · ");

    return '<div class="event-card">' +
      '<h3>' + escapeHtml(ev.name) + '</h3>' +
      (meta ? '<p style="color:#8fa0b8; font-size:14px; margin-bottom:8px;">' + escapeHtml(meta) + '</p>' : '') +
      '<div class="hero-actions" style="margin-top:14px;">' +
        '<a href="' + joinUrl + '" class="btn primary">Join Event</a>' +
        '<a href="' + TESTFLIGHT_URL + '" class="btn secondary" target="_blank" rel="noopener noreferrer">Get the App</a>' +
      '</div>' +
    '</div>';
  }).join("");
}

function showEventState(eventId) {
  if (!yourEvent || !yourEventBody) return;

  const deepLink = "beacon://event/" + eventId;

  yourEventBody.innerHTML =
    '<div class="event-meta-card" style="display:inline-block; margin-bottom:16px;">' +
      '<div class="meta-label">Current event</div>' +
      '<div class="meta-value" style="font-size:14px; overflow-wrap:anywhere;">' + eventId + '</div>' +
    '</div>' +
    '<div class="hero-actions">' +
      '<a href="' + deepLink + '" class="btn primary">Open Nearify</a>' +
      '<a href="join/?event=' + encodeURIComponent(eventId) + '" class="btn secondary">Event join page</a>' +
    '</div>';

  yourEvent.style.display = "";
}

async function loadHomeIntelligence(eventId) {
  if (!intelSection || !intelContainer) return;

  const data = await fetchIntelligence(eventId);
  if (!data || data.length === 0) return;

  renderIntelligenceInto(intelContainer, data);
  intelSection.style.display = "";
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

init().catch((err) => console.error("[Home] init failed:", err));
