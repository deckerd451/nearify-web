import { getCurrentUser, getCurrentEventId } from "./appState.js";
import { fetchIntelligence, fetchEventMeta, renderIntelligenceInto } from "./intelligence.js";
import { fetchPublicEvents } from "./events.js";
import { logger } from "./logger.js";

// DOM refs
const upcomingListEl = document.getElementById("homeUpcomingList");
const pastSection    = document.getElementById("homePastSection");
const pastListEl     = document.getElementById("homePastList");
const intelSection   = document.getElementById("homeIntelSection");
const intelContainer = document.getElementById("homeIntelContainer");

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str ?? "");
  return d.innerHTML;
}

function renderEventCard(ev, isPast = false) {
  const dateStr  = ev.starts_at
    ? new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";
  const meta     = [ev.location, dateStr].filter(Boolean).join(" · ");
  const detailUrl = ev.slug
    ? "events/event.html?slug=" + encodeURIComponent(ev.slug)
    : "events/event.html?id="   + encodeURIComponent(ev.id);

  return '<div class="event-card' + (isPast ? " event-card-past" : "") + '">' +
    (isPast ? '<div class="card-badge-past">Past</div>' : "") +
    '<h3><a href="' + detailUrl + '" class="event-list-name-link">' + escapeHtml(ev.name) + '</a></h3>' +
    (meta ? '<p style="color:#8fa0b8;font-size:14px;margin:6px 0 14px;">' + escapeHtml(meta) + '</p>' : "") +
    '<a href="' + detailUrl + '" class="btn primary">View Event</a>' +
  '</div>';
}

function skeletonCard() {
  return '<div class="skeleton-card" style="text-align:left;">' +
    '<div class="skeleton-line title"></div>' +
    '<div class="skeleton-line meta"></div>' +
    '<div class="skeleton-line button"></div>' +
  '</div>';
}

async function loadPublicEvents() {
  if (!upcomingListEl) return;

  upcomingListEl.innerHTML = skeletonCard() + skeletonCard();

  let events;
  try {
    events = await fetchPublicEvents();
  } catch {
    upcomingListEl.innerHTML =
      '<p class="home-intel-subhead" style="color:#f87171;">Could not load events. Please refresh.</p>';
    return;
  }

  const now      = new Date();
  const upcoming = (events || []).filter(ev => !ev.starts_at || new Date(ev.starts_at) >= now);
  const past     = (events || [])
    .filter(ev => ev.starts_at && new Date(ev.starts_at) < now)
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

  upcomingListEl.innerHTML = upcoming.length
    ? upcoming.map(ev => renderEventCard(ev)).join("")
    : '<p class="home-intel-subhead">No upcoming events scheduled. Check back soon.</p>';

  if (past.length && pastSection && pastListEl) {
    pastListEl.innerHTML = past.map(ev => renderEventCard(ev, true)).join("");
    pastSection.style.display = "";
  }
}

async function loadHomeIntelligence(eventId) {
  if (!intelSection || !intelContainer) return;

  const [{ data, fallbackDecision }, eventMeta] = await Promise.all([
    fetchIntelligence(eventId),
    fetchEventMeta(eventId),
  ]);

  renderIntelligenceInto(intelContainer, data, eventMeta, fallbackDecision);
  intelSection.style.display = "";
}

async function init() {
  await loadPublicEvents();

  const user    = await getCurrentUser();
  const eventId = getCurrentEventId();

  if (!user) {
    logger.log("[Home] Not signed in — public mode");
    return;
  }

  logger.log("[Home] Signed in as:", user.email);

  if (eventId) {
    await loadHomeIntelligence(eventId);
  }
}

init().catch(err => logger.error("[Home] init failed:", err));
