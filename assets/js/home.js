/**
 * home.js — Homepage state-aware behavior
 *
 * - Loads public events from Supabase (for all visitors)
 * - If signed in with a recent event, resolves the event record
 *   and shows a human-readable "Continue your recent event" section
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
    await showRecentEvent(eventId);
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
    const meta = [ev.location, dateStr].filter(Boolean).join(" \u00b7 ");

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

/**
 * Resolve the event record from Supabase and render a human-readable card.
 * Falls back to a minimal display if the record can't be fetched.
 */
async function showRecentEvent(eventId) {
  if (!yourEvent || !yourEventBody) return;

  // Try to resolve the real event record
  let eventName = null;
  let eventLocation = null;
  let eventDate = null;

  try {
    const { data, error } = await supabase
      .from("events")
      .select("name, location, starts_at")
      .eq("id", eventId)
      .maybeSingle();

    if (!error && data) {
      eventName = data.name;
      eventLocation = data.location;
      eventDate = data.starts_at
        ? new Date(data.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : null;
    }
  } catch (e) {
    console.warn("[Home] Could not resolve event record:", e.message);
  }

  const deepLink = "beacon://event/" + eventId;
  const joinUrl = "join/?event=" + encodeURIComponent(eventId) +
    (eventName ? "&name=" + encodeURIComponent(eventName) : "");

  const title = eventName || "Your recent event";
  const meta = [eventLocation, eventDate].filter(Boolean).join(" \u00b7 ");

  yourEventBody.innerHTML =
    '<div class="event-card" style="text-align:left; max-width:600px; margin:0 auto;">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      (meta ? '<p style="color:#8fa0b8; font-size:14px; margin-bottom:12px;">' + escapeHtml(meta) + '</p>' : '') +
      '<div class="hero-actions" style="margin-top:14px;">' +
        '<a href="' + deepLink + '" class="btn primary">Open in Nearify</a>' +
        '<a href="' + joinUrl + '" class="btn secondary">Return to join page</a>' +
      '</div>' +
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
