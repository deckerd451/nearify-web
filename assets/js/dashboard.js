/**
 * dashboard.js — Event Control Center
 *
 * Renders the homepage as a live event management dashboard for
 * authenticated organizers. Logged-out users see a minimal landing.
 *
 * Extension point for Live Mode:
 *   Each event card contains a hidden <div class="cc-live-panel" id="cc-live-<eventId}">
 *   Call getLivePanelEl(eventId) to reveal it and get a reference for DOM injection.
 */

import { supabase, getSessionCached } from "./supabaseClient.js";
import { saveEvent, deleteEvent, getOrganizerProfileId, fetchPublicEvents } from "./events.js";
import { trackAppCtaClick, trackPageView } from "./analytics.js";
import { patchAppStoreLinks } from "./config.js";
import { escapeHtml, escapeAttr, copyText } from "./utils.js";
import { logger } from "./logger.js";
import { buildEventDecisionReasons, buildKnownAttendeeReason, computeEventDecisionScore } from "./attendanceReasons.js";
import { pollingCoordinator } from "./pollingCoordinator.js";
logger.log("[Dashboard] dashboard.js loaded");

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_DETAIL_URL = (id) => `/events/event.html?id=${encodeURIComponent(id)}`;
const EDIT_URL         = (id) => `/admin/event-setup.html?edit=${encodeURIComponent(id)}`;
const DASHBOARD_EVENTS_POLL_KEY = "dashboard:events-refresh";
const SEE_AGAIN_LIMIT = 5;
const RECOMMENDED_LIMIT = 4;

const INTENT_LABELS = {
  meet_people:    "Meet people",
  find_cofounder: "Find a cofounder",
  hire:           "Hire",
  explore_ideas:  "Explore ideas",
  demo_something: "Demo something",
};

function formatDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return ""; }
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "numeric", minute: "2-digit",
    });
  } catch { return ""; }
}

function formatDateTime(ts) {
  if (!ts) return "";
  const date = formatDate(ts);
  const time = formatTime(ts);
  return [date, time].filter(Boolean).join(" · ");
}

function getEventDetailUrl(event) {
  if (event?.slug) return `/events/event.html?slug=${encodeURIComponent(event.slug)}`;
  return EVENT_DETAIL_URL(event.id);
}

function buildJoinUrl(event) {
  const params = new URLSearchParams();
  params.set("event", event.id);
  if (event.name) params.set("name", event.name);
  return `https://nearify.org/join/?${params.toString()}`;
}

function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Status ───────────────────────────────────────────────────────────────────

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function getEventStatus(ev) {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const startDate = ev.starts_at ? new Date(ev.starts_at) : null;
  const endDate = ev.ends_at ? new Date(ev.ends_at) : null;
  const start = startDate?.getTime() ?? null;
  const end = endDate?.getTime() ?? null;

  if (ev.is_active === false) return "ended";
  if (end && nowMs > end) return "ended";

  if (start && nowMs >= start) {
    if (end) return "live";
    return isSameLocalDay(startDate, now) ? "live" : "ended";
  }

  return "upcoming";
}

function statusLabel(s) {
  return { live: "Live", upcoming: "Upcoming", ended: "Ended" }[s] ?? "Upcoming";
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function handleSignInClick() {
  const { data } = await getSessionCached();

  if (data?.session?.user) {
    await loadDashboard();
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/events/index.html",
    },
  });

  if (error) logger.error("[Dashboard] sign-in failed:", error);
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchMyEvents() {
  const profileId = await getOrganizerProfileId();
  if (!profileId) return [];

  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, location, starts_at, ends_at, is_active, description, created_at")
    .eq("created_by", profileId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { logger.error("[Dashboard] fetchMyEvents:", error); return []; }
  return data || [];
}

async function fetchMyConnections() {
  const { data, error } = await supabase.rpc("get_my_connections", { p_status: "confirmed" });
  if (error) {
    logger.warn("[Dashboard] fetchMyConnections:", error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function fetchCurrentProfileId() {
  return getOrganizerProfileId();
}

async function fetchUpcomingEventsForConnections(connections, currentProfileId = null) {
  if (!connections.length) return [];

  const connectionIds = connections.map((conn) => conn.profile_id).filter(Boolean);
  if (!connectionIds.length) return [];

  const now = new Date();
  const nowIso = now.toISOString();
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id, name, slug, starts_at, ends_at, is_active")
    .is("deleted_at", null)
    .or(`starts_at.is.null,starts_at.gte.${nowIso}`)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(50);

  if (eventsError) {
    logger.warn("[Dashboard] see again events:", eventsError);
    return [];
  }

  const eventIds = (events || []).map((event) => event.id).filter(Boolean);
  if (!eventIds.length) return [];

  const { data: attendees, error: attendeesError } = await supabase
    .from("event_attendees")
    .select("event_id, profile_id, intent_primary, intent_secondary")
    .in("event_id", eventIds)
    .in("profile_id", connectionIds);

  if (attendeesError) {
    logger.warn("[Dashboard] see again attendees:", attendeesError);
    return [];
  }

  const eventsById = new Map((events || []).map((event) => [event.id, event]));
  const connectionsById = new Map(connections.map((conn) => [conn.profile_id, conn]));
  const attendeesByEvent = new Map();
  for (const attendee of attendees || []) {
    if (!attendeesByEvent.has(attendee.event_id)) attendeesByEvent.set(attendee.event_id, []);
    attendeesByEvent.get(attendee.event_id).push(attendee);
  }

  return [...attendeesByEvent.entries()]
    .map(([eventId, eventAttendees]) => {
      const event = eventsById.get(eventId);
      if (!event) return null;
      const knownAttendees = eventAttendees
        .map((attendee) => connectionsById.get(attendee.profile_id))
        .filter(Boolean);
      if (!knownAttendees.length) return null;
      const reasons = buildEventDecisionReasons({ connections: knownAttendees, eventAttendees, currentProfileId });
      const topConnection = knownAttendees.find((connection) => connection.profile_id === reasons[0]?.personId) || knownAttendees[0];
      return {
        event,
        connection: topConnection,
        connections: knownAttendees,
        reason: reasons[0] || null,
        eventScore: computeEventDecisionScore(reasons, event, { now }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.eventScore !== a.eventScore) return b.eventScore - a.eventScore;
      const aStart = a.event.starts_at ? new Date(a.event.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bStart = b.event.starts_at ? new Date(b.event.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
      return String(a.event.name || "").localeCompare(String(b.event.name || ""));
    })
    .slice(0, SEE_AGAIN_LIMIT);
}

async function fetchAttendeeCounts(eventIds) {
  if (!eventIds.length) return new Map();

  const { data, error } = await supabase
    .from("event_attendees")
    .select("event_id")
    .in("event_id", eventIds);

  if (error) { logger.warn("[Dashboard] attendee counts:", error); return new Map(); }

  const counts = new Map();
  for (const row of (data || [])) {
    counts.set(row.event_id, (counts.get(row.event_id) || 0) + 1);
  }
  return counts;
}

async function fetchAttendeesForEvents(eventIds) {
  if (!eventIds.length) return new Map();

  const { data, error } = await supabase
    .from("event_attendees")
    .select("event_id, profile_id, intent_primary, intent_secondary")
    .in("event_id", eventIds);

  if (error) {
    logger.warn("[Dashboard] recommendation attendees:", error);
    return new Map();
  }

  const attendeesByEvent = new Map();
  for (const row of (data || [])) {
    if (!attendeesByEvent.has(row.event_id)) attendeesByEvent.set(row.event_id, []);
    attendeesByEvent.get(row.event_id).push(row);
  }
  return attendeesByEvent;
}

async function buildRecommendedEvents(connections, currentProfileId) {
  const publicEvents = await fetchPublicEvents();
  const now = new Date();
  const upcoming = (publicEvents || [])
    .filter((event) => !event.starts_at || new Date(event.starts_at) >= now)
    .sort((a, b) => {
      const aStart = a.starts_at ? new Date(a.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bStart = b.starts_at ? new Date(b.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aStart - bStart;
    });
  const eventIds = upcoming.map((event) => event.id).filter(Boolean);
  const attendeesByEvent = await fetchAttendeesForEvents(eventIds);
  const connectionsById = new Map(
    (connections || [])
      .filter((connection) => connection?.profile_id)
      .map((connection) => [connection.profile_id, connection])
  );

  return upcoming
    .map((event) => {
      const eventAttendees = attendeesByEvent.get(event.id) || [];
      const knownAttendees = eventAttendees
        .map((attendee) => connectionsById.get(attendee.profile_id))
        .filter(Boolean);
      const reasons = buildEventDecisionReasons({
        connections: knownAttendees,
        eventAttendees,
        currentProfileId,
      });
      const topReason = reasons[0] || null;
      return {
        event,
        reason: topReason,
        reasons,
        eventScore: computeEventDecisionScore(reasons, event, { now }),
      };
    })
    .filter((recommendation) => recommendation.reason)
    .sort((a, b) => {
      if (b.eventScore !== a.eventScore) return b.eventScore - a.eventScore;
      const aStart = a.event.starts_at ? new Date(a.event.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bStart = b.event.starts_at ? new Date(b.event.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
      return String(a.event.name || "").localeCompare(String(b.event.name || ""));
    })
    .slice(0, RECOMMENDED_LIMIT);
}

async function fetchIntentDistribution(eventIds) {
  if (!eventIds.length) return new Map();

  const { data, error } = await supabase
    .from("event_attendees")
    .select("event_id, intent_primary")
    .in("event_id", eventIds)
    .not("intent_primary", "is", null);

  if (error) { logger.warn("[Dashboard] intent distribution:", error); return new Map(); }

  // Map<eventId, Map<intent, count>>
  const result = new Map();
  for (const row of (data || [])) {
    if (!result.has(row.event_id)) result.set(row.event_id, new Map());
    const m = result.get(row.event_id);
    m.set(row.intent_primary, (m.get(row.intent_primary) || 0) + 1);
  }
  return result;
}

async function endEvent(id) {
  return saveEvent({ id, is_active: false }, true);
}

async function createEvent(fields, isOrganizer = true) {
  return saveEvent({ id: generateUUID(), ...fields }, false, isOrganizer);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderSkeletonCards(n = 2) {
  return Array.from({ length: n }).map(() => `
    <div class="cc-event-card cc-event-card--skeleton">
      <div class="cc-event-top">
        <div style="flex:1;">
          <div class="skeleton-line" style="width:52%;height:20px;margin-bottom:10px;"></div>
          <div class="skeleton-line" style="width:34%;height:13px;"></div>
        </div>
        <div class="skeleton-line" style="width:76px;height:26px;border-radius:99px;"></div>
      </div>
      <div style="margin:16px 0 20px;">
        <div class="skeleton-line" style="width:48px;height:32px;margin-bottom:5px;border-radius:6px;"></div>
        <div class="skeleton-line" style="width:36px;height:11px;border-radius:4px;"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <div class="skeleton-line button" style="width:86px;height:34px;"></div>
        <div class="skeleton-line button" style="width:108px;height:34px;"></div>
        <div class="skeleton-line button" style="width:78px;height:34px;"></div>
      </div>
    </div>
  `).join("");
}

function renderEmptyState() {
  return `
    <div class="cc-empty-state">
      <p class="cc-empty-title">No events yet.</p>
      <p class="cc-empty-body">Create your first event — or <a href="/events/index.html" class="cc-empty-link">browse what's happening</a> across the community.</p>
    </div>
  `;
}

function renderEventCard(ev, count, intentMap, relationshipReason = "") {
  const status    = getEventStatus(ev);
  const jUrl      = buildJoinUrl(ev);
  const detailUrl = EVENT_DETAIL_URL(ev.id);

  const dateStr   = ev.starts_at
    ? `${formatDate(ev.starts_at)} · ${formatTime(ev.starts_at)}`
    : "";
  const metaParts = [ev.location, dateStr].filter(Boolean);
  const metaStr   = metaParts.join(" · ");

  // Participation context line
  const sortedGoals = intentMap ? [...intentMap.entries()].sort((a, b) => b[1] - a[1]) : [];
  const withGoals   = sortedGoals.reduce((s, [, n]) => s + n, 0);
  const topGoalKey  = sortedGoals[0]?.[0];
  const participationParts = [];
  if (withGoals) participationParts.push(`${withGoals} with goals`);
  if (topGoalKey && INTENT_LABELS[topGoalKey]) participationParts.push(INTENT_LABELS[topGoalKey]);
  const participationCtx = participationParts.join(" · ");

  const endItem = status !== "ended" ? `
    <button class="cc-overflow-item cc-overflow-item--danger"
      data-action="end-event"
      data-event-id="${escapeAttr(ev.id)}"
      data-event-name="${escapeAttr(ev.name)}">End Event</button>` : "";

  const metricClass = count === 0 ? " cc-metric-value--zero" : "";

  return `
    <article class="cc-event-card cc-event-card--${status}" data-event-id="${escapeAttr(ev.id)}">
      <div class="cc-event-core">

        <div class="cc-event-top">
          <div class="cc-event-top-text">
            <h3 class="cc-event-name">${escapeHtml(ev.name)}</h3>
            ${metaStr ? `<p class="cc-event-meta">${escapeHtml(metaStr)}</p>` : ""}
          </div>
          <div class="cc-event-top-right">
            <span class="cc-event-status cc-event-status--${status}">
              <span class="cc-status-dot"></span>${statusLabel(status)}
            </span>
            <div class="cc-overflow-wrap">
              <button class="cc-overflow-trigger" data-action="toggle-overflow" aria-label="More options">···</button>
              <div class="cc-overflow-menu" hidden>
                <a class="cc-overflow-item" href="${escapeAttr(EDIT_URL(ev.id))}">Edit</a>
                <button class="cc-overflow-item" data-action="copy-link" data-url="${escapeAttr(jUrl)}">Copy Link</button>
                ${endItem}
                <button class="cc-overflow-item cc-overflow-item--danger"
                  data-action="archive"
                  data-event-id="${escapeAttr(ev.id)}"
                  data-event-name="${escapeAttr(ev.name)}">Archive</button>
              </div>
            </div>
          </div>
        </div>

        <div class="cc-event-metrics">
          <div class="cc-metric">
            <span class="cc-metric-value${metricClass}">${count || "0"}</span>
            <span class="cc-metric-label">joined</span>
          </div>
        </div>

        ${relationshipReason
          ? `<p class="cc-participation-context">${escapeHtml(relationshipReason)}</p>`
          : participationCtx ? `<p class="cc-participation-context">${escapeHtml(participationCtx)}</p>` : ""}

        <div class="cc-event-actions">
          <a class="btn primary cc-action-btn" href="${escapeAttr(detailUrl)}">View Event</a>
          <button class="btn secondary cc-action-btn"
            data-action="show-qr"
            data-event-id="${escapeAttr(ev.id)}"
            data-event-name="${escapeAttr(ev.name)}"
            data-join-url="${escapeAttr(jUrl)}">Show QR</button>
        </div>

      </div>
      <div class="cc-live-panel" id="cc-live-${escapeAttr(ev.id)}" hidden></div>
    </article>
  `;
}

function renderEcosystemHero(events, counts, intentsByEvent) {
  const hero = document.getElementById("ecosystemHero");
  if (!hero) return;

  // Only show the ecosystem hero when an event is actively live
  const liveEvents = events.filter((e) => getEventStatus(e) === "live");
  if (!liveEvents.length) { hero.style.display = "none"; return; }

  const featured   = liveEvents[0];
  const status     = "live";
  const count      = counts.get(featured.id) || 0;
  const intentMap  = intentsByEvent.get(featured.id) || new Map();
  const sortedGoals = [...intentMap.entries()].sort((a, b) => b[1] - a[1]);
  const withGoals  = sortedGoals.reduce((s, [, n]) => s + n, 0);
  const topGoals   = sortedGoals.slice(0, 3);

  const totalAttendees = [...counts.values()].reduce((s, n) => s + n, 0);

  const metaParts = [featured.location, featured.starts_at ? formatDate(featured.starts_at) : ""].filter(Boolean);
  const metaStr   = metaParts.join(" \u00b7 ");

  const isLive     = true;
  const kickerText = "Live now";

  const detailUrl = EVENT_DETAIL_URL(featured.id);
  const jUrl      = buildJoinUrl(featured);

  // Build DOM
  hero.innerHTML = "";

  // Kicker
  const kickerEl = document.createElement("div");
  kickerEl.className = "cc-ecosystem-kicker";
  if (isLive) {
    const dot = document.createElement("span");
    dot.className = "cc-ecosystem-live-dot";
    kickerEl.appendChild(dot);
  }
  kickerEl.appendChild(document.createTextNode(kickerText));
  hero.appendChild(kickerEl);

  // Featured event container
  const featuredEl = document.createElement("div");
  featuredEl.className = "cc-featured-event" + (isLive ? " cc-featured-event--live" : "");

  // Header row
  const headerEl = document.createElement("div");
  headerEl.className = "cc-featured-event-header";

  const infoEl = document.createElement("div");
  infoEl.className = "cc-featured-event-info";

  const nameEl = document.createElement("h2");
  nameEl.className = "cc-featured-event-name";
  nameEl.textContent = featured.name;
  infoEl.appendChild(nameEl);

  if (metaStr) {
    const metaEl = document.createElement("p");
    metaEl.className = "cc-featured-event-meta";
    metaEl.textContent = metaStr;
    infoEl.appendChild(metaEl);
  }

  headerEl.appendChild(infoEl);

  const statusEl = document.createElement("span");
  statusEl.className = "cc-event-status cc-event-status--" + status;
  const statusDot = document.createElement("span");
  statusDot.className = "cc-status-dot";
  statusEl.appendChild(statusDot);
  statusEl.appendChild(document.createTextNode(statusLabel(status)));
  headerEl.appendChild(statusEl);

  featuredEl.appendChild(headerEl);

  // Participation row
  const partEl = document.createElement("div");
  partEl.className = "cc-featured-participation";

  const countEl = document.createElement("span");
  countEl.className = "cc-featured-count";
  countEl.textContent = String(count);
  partEl.appendChild(countEl);

  const countLabel = document.createElement("span");
  countLabel.className = "cc-featured-count-label";
  countLabel.textContent = "people joined";
  partEl.appendChild(countLabel);

  if (withGoals) {
    const goalNote = document.createElement("span");
    goalNote.className = "cc-featured-goal-note";
    goalNote.textContent = "\u00b7 " + withGoals + " with goals set";
    partEl.appendChild(goalNote);
  }

  featuredEl.appendChild(partEl);

  // Goal pills
  if (topGoals.length) {
    const goalsRow = document.createElement("div");
    goalsRow.className = "cc-featured-goals-row";
    for (const [intent, n] of topGoals) {
      const pill = document.createElement("span");
      pill.className = "cc-goal-pill";
      const pillLabel = document.createElement("span");
      pillLabel.className = "cc-goal-pill-label";
      pillLabel.textContent = INTENT_LABELS[intent] || intent;
      const pillCount = document.createElement("span");
      pillCount.className = "cc-goal-pill-count";
      pillCount.textContent = String(n);
      pill.appendChild(pillLabel);
      pill.appendChild(pillCount);
      goalsRow.appendChild(pill);
    }
    featuredEl.appendChild(goalsRow);
  }

  // Actions
  const actionsEl = document.createElement("div");
  actionsEl.className = "cc-featured-actions";

  const viewLink = document.createElement("a");
  viewLink.href = detailUrl;
  viewLink.className = "btn primary";
  viewLink.textContent = "View Event";
  actionsEl.appendChild(viewLink);

  const qrBtn = document.createElement("button");
  qrBtn.className = "btn secondary cc-action-btn";
  qrBtn.setAttribute("data-action", "show-qr");
  qrBtn.setAttribute("data-event-id", featured.id);
  qrBtn.setAttribute("data-event-name", featured.name);
  qrBtn.setAttribute("data-join-url", jUrl);
  qrBtn.textContent = "Show QR";
  qrBtn.addEventListener("click", () => {
    openQrModal(featured.id, featured.name, jUrl);
  });
  actionsEl.appendChild(qrBtn);

  featuredEl.appendChild(actionsEl);
  hero.appendChild(featuredEl);

  // Aggregate line
  if (events.length > 1 && totalAttendees > count) {
    const aggEl = document.createElement("p");
    aggEl.className = "cc-ecosystem-aggregate";
    aggEl.textContent = totalAttendees + " total attendees across your " + events.length + " events";
    hero.appendChild(aggEl);
  }

  hero.style.display = "";
}

// ─── Event ordering ───────────────────────────────────────────────────────────

/**
 * Sort events for dashboard display:
 *   1. Live events (currently happening) — most urgent first
 *   2. Upcoming events — soonest start date first (chronological ascending)
 *   3. Ended events — weighted by recency + participation (not purely chronological)
 *
 * Past event relevance score:
 *   - 60% recency (days since event, decays over 90 days)
 *   - 40% participation (attendee count, capped at 50 for normalization)
 *
 * This keeps recent high-attendance events visible longer than
 * old low-attendance ones, while still being deterministic and simple.
 */
function sortEventsForDashboard(events, counts) {
  const now = Date.now();

  const live = [];
  const upcoming = [];
  const ended = [];

  for (const ev of events) {
    const status = getEventStatus(ev);
    if (status === "live") live.push(ev);
    else if (status === "upcoming") upcoming.push(ev);
    else ended.push(ev);
  }

  // Live: sort by start time ascending (earliest-started live event first)
  live.sort((a, b) => {
    const aStart = a.starts_at ? new Date(a.starts_at).getTime() : 0;
    const bStart = b.starts_at ? new Date(b.starts_at).getTime() : 0;
    return aStart - bStart;
  });

  // Upcoming: soonest first (chronological ascending)
  upcoming.sort((a, b) => {
    const aStart = a.starts_at ? new Date(a.starts_at).getTime() : Infinity;
    const bStart = b.starts_at ? new Date(b.starts_at).getTime() : Infinity;
    return aStart - bStart;
  });

  // Ended: relevance-weighted recency
  ended.sort((a, b) => {
    const scoreA = computePastRelevance(a, counts.get(a.id) || 0, now);
    const scoreB = computePastRelevance(b, counts.get(b.id) || 0, now);
    return scoreB - scoreA; // higher score = more relevant = shown first
  });

  return [...live, ...upcoming, ...ended];
}

function computePastRelevance(event, attendeeCount, nowMs) {
  // Recency: how recently did this event happen? (0-1, decays over 90 days)
  const eventTime = event.starts_at
    ? new Date(event.starts_at).getTime()
    : event.created_at
      ? new Date(event.created_at).getTime()
      : 0;
  const daysSince = Math.max(0, (nowMs - eventTime) / 86_400_000);
  const recency = Math.max(0, 1 - daysSince / 90);

  // Participation: normalized attendee count (0-1, capped at 50)
  const participation = Math.min(1, attendeeCount / 50);

  // Weighted score: 60% recency, 40% participation
  return 0.6 * recency + 0.4 * participation;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderDashboard(events, counts, intentsByEvent, relationshipReasons = new Map()) {
  const list = document.getElementById("eventCardList");
  if (!list) return;

  if (!events.length) {
    list.innerHTML = renderEmptyState();
    return;
  }

  const sorted = sortEventsForDashboard(events, counts);

  const groups = { live: [], upcoming: [], ended: [] };
  for (const ev of sorted) groups[getEventStatus(ev)].push(ev);

  const renderCards = (evs) =>
    evs.map((ev) => renderEventCard(
      ev,
      counts.get(ev.id) ?? 0,
      intentsByEvent.get(ev.id) || new Map(),
      relationshipReasons.get(ev.id) || ""
    )).join("");

  let html = "";

  if (groups.live.length) {
    html += `<div class="cc-event-group-heading cc-event-group-heading--live"><span class="cc-group-live-dot"></span>Live</div>`;
    html += renderCards(groups.live);
  }
  if (groups.upcoming.length) {
    html += `<div class="cc-event-group-heading">Upcoming</div>`;
    html += renderCards(groups.upcoming);
  }
  if (groups.ended.length) {
    html += `<div class="cc-event-group-heading cc-event-group-heading--past">Past</div>`;
    html += renderCards(groups.ended);
  }

  list.innerHTML = html;
}

function renderDashboardError(err) {
  const list = document.getElementById("eventCardList");
  if (!list) return;
  list.innerHTML = `
    <div class="cc-empty-state">
      <p class="cc-empty-title">Couldn’t load events.</p>
      <p class="cc-empty-body">${escapeHtml(err?.message || "Please refresh and try again.")}</p>
    </div>
  `;
}


function renderNetworkMemoryWidget(connections, events) {
  const widget = document.getElementById("networkMemoryWidget");
  if (!widget) return;

  const shouldShow = connections.length > 0 || events.length === 0 || !events.some((event) => ["live", "upcoming"].includes(getEventStatus(event)));
  if (!shouldShow) {
    widget.hidden = true;
    widget.replaceChildren();
    return;
  }

  const countLabel = `${connections.length} ${connections.length === 1 ? "Connection" : "Connections"}`;
  const top = document.createElement("div");
  top.className = "cc-network-widget-top";

  const textWrap = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "cc-network-kicker";
  kicker.textContent = "Relationship memory";
  const title = document.createElement("h2");
  title.className = "cc-network-title";
  title.textContent = "My Network";
  const count = document.createElement("p");
  count.className = "cc-network-count";
  count.textContent = countLabel;
  textWrap.append(kicker, title, count);

  const link = document.createElement("a");
  link.className = "btn secondary";
  link.href = "/connections/";
  link.textContent = "View All Connections";
  top.append(textWrap, link);

  const recent = connections.slice(0, 3);
  const recentLabel = document.createElement("p");
  recentLabel.className = "cc-network-count";
  recentLabel.textContent = recent.length
    ? "Recently connected:"
    : "People you meet at Nearify events will appear here.";

  const children = [top, recentLabel];
  if (recent.length) {
    const list = document.createElement("ul");
    list.className = "cc-network-recent";
    recent.forEach((conn) => {
      const item = document.createElement("li");
      item.className = "cc-network-person";
      item.textContent = conn.name || "Someone you met";
      list.appendChild(item);
    });
    children.push(list);
  }

  widget.replaceChildren(...children);
  widget.hidden = false;
}


function buildRelationshipReasonMap(opportunities) {
  const matchesByEvent = new Map();
  for (const { event, connection } of opportunities || []) {
    if (!event?.id || !connection?.profile_id) continue;
    if (!matchesByEvent.has(event.id)) matchesByEvent.set(event.id, new Map());
    matchesByEvent.get(event.id).set(connection.profile_id, connection);
  }

  const reasons = new Map();
  for (const [eventId, matches] of matchesByEvent.entries()) {
    const reason = buildKnownAttendeeReason([...matches.values()]);
    if (reason) reasons.set(eventId, reason);
  }
  return reasons;
}

function renderSeeAgainWidget(opportunities) {
  const widget = document.getElementById("seeAgainWidget");
  if (!widget) return;

  if (!opportunities.length) {
    widget.hidden = true;
    widget.replaceChildren();
    return;
  }

  const top = document.createElement("div");
  top.className = "cc-network-widget-top";

  const textWrap = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "cc-network-kicker";
  kicker.textContent = "Upcoming with your network";
  const title = document.createElement("h2");
  title.className = "cc-network-title";
  title.textContent = "See them again soon";
  const count = document.createElement("p");
  count.className = "cc-network-count";
  count.textContent = "People you know are going to these events.";
  textWrap.append(kicker, title, count);
  top.append(textWrap);

  const list = document.createElement("ul");
  list.className = "cc-see-again-list";

  opportunities.forEach(({ connection, event }) => {
    const item = document.createElement("li");
    item.className = "cc-see-again-item";

    const details = document.createElement("div");
    const heading = document.createElement("p");
    heading.className = "cc-see-again-heading";
    heading.textContent = `${connection.name || "Someone you met"} — ${event.name || "Upcoming event"}`;
    details.appendChild(heading);

    const dateText = formatDateTime(event.starts_at);
    if (dateText) {
      const meta = document.createElement("p");
      meta.className = "cc-see-again-meta";
      meta.textContent = dateText;
      details.appendChild(meta);
    }

    const link = document.createElement("a");
    link.className = "btn secondary";
    link.href = getEventDetailUrl(event);
    link.textContent = "View Event";

    item.append(details, link);
    list.appendChild(item);
  });

  widget.replaceChildren(top, list);
  widget.hidden = false;
}

function renderRecommendedForYouWidget(recommendations) {
  const widget = document.getElementById("recommendedForYouWidget");
  if (!widget) return;

  if (!recommendations.length) {
    widget.hidden = true;
    widget.replaceChildren();
    return;
  }

  const top = document.createElement("div");
  top.className = "cc-network-widget-top";

  const textWrap = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "cc-network-kicker";
  kicker.textContent = "EventReason ranked";
  const title = document.createElement("h2");
  title.className = "cc-network-title";
  title.textContent = "Recommended For You";
  const subtitle = document.createElement("p");
  subtitle.className = "cc-network-count";
  subtitle.textContent = "Upcoming events surfaced by people you know, shared goals, and event momentum.";
  textWrap.append(kicker, title, subtitle);
  top.append(textWrap);

  const list = document.createElement("ul");
  list.className = "cc-recommended-list";

  recommendations.forEach(({ event, reason }) => {
    const item = document.createElement("li");
    item.className = "cc-recommended-item";

    const details = document.createElement("div");
    const heading = document.createElement("p");
    heading.className = "cc-recommended-heading";
    heading.textContent = event.name || "Upcoming event";
    details.appendChild(heading);

    const reasonText = document.createElement("p");
    reasonText.className = "cc-recommended-reason";
    reasonText.textContent = reason.title;
    details.appendChild(reasonText);

    if (reason.description) {
      const reasonDescription = document.createElement("p");
      reasonDescription.className = "cc-recommended-meta";
      reasonDescription.textContent = reason.description;
      details.appendChild(reasonDescription);
    }

    const dateText = formatDateTime(event.starts_at);
    if (dateText) {
      const meta = document.createElement("p");
      meta.className = "cc-recommended-meta";
      meta.textContent = dateText;
      details.appendChild(meta);
    }

    const link = document.createElement("a");
    link.className = "btn primary";
    link.href = getEventDetailUrl(event);
    link.textContent = "View Event";

    item.append(details, link);
    list.appendChild(item);
  });

  widget.replaceChildren(top, list);
  widget.hidden = false;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function refreshDashboard() {
  if (refreshDashboard._inFlight) return refreshDashboard._inFlight;
  refreshDashboard._inFlight = (async () => {
  const list = document.getElementById("eventCardList");
  if (list) list.innerHTML = renderSkeletonCards();
  const [events, connections] = await Promise.all([
    fetchMyEvents(),
    fetchMyConnections(),
  ]);
  const currentProfileId = await fetchCurrentProfileId();
  const [seeAgainOpportunities, recommendations] = await Promise.all([
    fetchUpcomingEventsForConnections(connections, currentProfileId),
    buildRecommendedEvents(connections, currentProfileId),
  ]);
  const eventIds = events.map((e) => e.id);
  const [counts, intentsByEvent] = await Promise.all([
    eventIds.length ? fetchAttendeeCounts(eventIds) : Promise.resolve(new Map()),
    eventIds.length ? fetchIntentDistribution(eventIds) : Promise.resolve(new Map()),
  ]);
  renderEcosystemHero(events, counts, intentsByEvent);
  renderNetworkMemoryWidget(connections, events);
  renderRecommendedForYouWidget(recommendations);
  renderSeeAgainWidget(seeAgainOpportunities);
  renderDashboard(events, counts, intentsByEvent, buildRelationshipReasonMap(seeAgainOpportunities));
  })().finally(() => { refreshDashboard._inFlight = null; });
  return refreshDashboard._inFlight;
}

// ─── QR Modal ─────────────────────────────────────────────────────────────────

let _currentJoinUrl = null;
let _focusBeforeModal = null;

function openQrModal(eventId, eventName, jUrl) {
  _currentJoinUrl = jUrl;
  _focusBeforeModal = document.activeElement;

  const modal  = document.getElementById("qrModal");
  const title  = document.getElementById("qrModalTitle");
  const qrBox  = document.getElementById("qrModalQrCode");

  if (title) title.textContent = eventName;
  qrBox.innerHTML = "";

  if (typeof window.QRCode === "function") {
    new window.QRCode(qrBox, { text: jUrl, width: 220, height: 220 });
  }

  modal.hidden = false;
  document.body.classList.add("cc-modal-open");
  document.getElementById("closeQrModalBtn")?.focus();
  trackAppCtaClick("dashboard_show_qr", { eventId });
}

function closeQrModal() {
  document.getElementById("qrModal").hidden = true;
  document.body.classList.remove("cc-modal-open");
  _currentJoinUrl = null;
  _focusBeforeModal?.focus();
  _focusBeforeModal = null;
}

async function copyCurrentJoinLink(btn) {
  if (!_currentJoinUrl) return;
  const ok  = await copyText(_currentJoinUrl);
  const orig = btn?.textContent;
  if (btn) {
    btn.textContent = ok ? "Copied!" : "Failed";
    setTimeout(() => { btn.textContent = orig; }, 1400);
  }
}

// ─── Create Event Modal ───────────────────────────────────────────────────────

function openCreateModal() {
  _focusBeforeModal = document.activeElement;
  document.getElementById("createEventModal").hidden = false;
  document.body.classList.add("cc-modal-open");
  setTimeout(() => document.getElementById("ceEventName")?.focus(), 60);
}

function closeCreateModal() {
  document.getElementById("createEventModal").hidden = true;
  document.body.classList.remove("cc-modal-open");
  _focusBeforeModal?.focus();
  _focusBeforeModal = null;
  document.getElementById("createEventForm")?.reset();
  setCreateStatus("", false);
  const nameErr = document.getElementById("ceEventNameError");
  const nameIn  = document.getElementById("ceEventName");
  const slugEl  = document.getElementById("ceSlug");
  const slugErr = document.getElementById("ceSlugError");
  if (nameErr) nameErr.style.display = "none";
  if (nameIn)  nameIn.classList.remove("field-invalid");
  if (slugErr) slugErr.style.display = "none";
  if (slugEl)  { slugEl.classList.remove("field-invalid"); delete slugEl.dataset.userEdited; }
}

function setCreateStatus(msg, isError = false) {
  const el = document.getElementById("createEventStatus");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#f87171" : "var(--color-text-muted)";
}

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function handleCreateSubmit(e) {
  e.preventDefault();

  const nameEl  = document.getElementById("ceEventName");
  const name    = nameEl?.value.trim();
  const nameErr = document.getElementById("ceEventNameError");
  const slugEl  = document.getElementById("ceSlug");
  const slugErr = document.getElementById("ceSlugError");

  if (!name) {
    if (nameErr) nameErr.style.display = "";
    nameEl?.classList.add("field-invalid");
    nameEl?.focus();
    return;
  }
  if (nameErr) nameErr.style.display = "none";
  nameEl?.classList.remove("field-invalid");

  const rawSlug = slugEl?.value.trim();
  const slug = rawSlug || slugify(name) || null;
  if (rawSlug && !/^[a-z0-9-]+$/.test(rawSlug)) {
    if (slugErr) { slugErr.style.display = ""; slugErr.textContent = "Slug can only contain lowercase letters, numbers, and hyphens."; }
    slugEl?.classList.add("field-invalid");
    slugEl?.focus();
    return;
  }
  if (slugErr) slugErr.style.display = "none";
  slugEl?.classList.remove("field-invalid");

  const date     = document.getElementById("ceDate")?.value || null;
  const time     = document.getElementById("ceTime")?.value || null;
  const location = document.getElementById("ceLocation")?.value.trim() || null;
  const desc     = document.getElementById("ceDescription")?.value.trim() || null;

  // Convert local date+time to UTC ISO string (matches admin/event-setup.html behavior)
  let starts_at = null;
  if (date && time) {
    starts_at = new Date(`${date}T${time}:00`).toISOString();
  } else if (date) {
    starts_at = date;
  }

  logger.log("[Dashboard] createEvent timestamp:", {
    rawDate: date,
    rawTime: time,
    browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isoValue: starts_at,
  });

  const submitBtn = document.getElementById("createEventSubmitBtn");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add("loading"); }
  setCreateStatus("Saving…");

  const { error } = await createEvent({ name, slug, location, starts_at, description: desc }, isOrganizer);

  if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove("loading"); }

  if (error) {
    logger.error("[Dashboard] createEvent error:", error);
    setCreateStatus("Something went wrong. Please try again.", true);
    return;
  }

  setCreateStatus("Event created!");
  setTimeout(async () => {
    closeCreateModal();
    await refreshDashboard();
  }, 500);
}

// ─── Page state ───────────────────────────────────────────────────────────────

function hideAllViews() {
  document.getElementById("loadingView").style.display  = "none";
  document.getElementById("landingView").style.display  = "none";
  document.getElementById("dashboardView").style.display = "none";
}

function showLanding() {
  hideAllViews();
  document.getElementById("landingView").style.display = "flex";
}

function showDashboard() {
  hideAllViews();
  document.getElementById("dashboardView").style.display = "block";
}

function showLoading() {
  showDashboard();
  const list = document.getElementById("eventCardList");
  if (list) list.innerHTML = renderSkeletonCards();
}

function initDashboard() {
  logger.log("[Dashboard] init");

  bindStaticHandlers();

  // Supabase fires INITIAL_SESSION synchronously on registration (with the
  // session from storage, or null if a token exchange is still pending).
  // SIGNED_IN fires when a new sign-in completes (e.g. after OAuth redirect).
  // We do NOT use an async callback here — Supabase doesn't await them, so any
  // thrown error would be silently swallowed and leave the page blank.
  supabase.auth.onAuthStateChange((event, session) => {
    logger.log("[Dashboard] auth change:", event, !!session?.user);

    if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session?.user)) {
      pollingCoordinator.stop(DASHBOARD_EVENTS_POLL_KEY);
      showLanding();
    } else if (event === "SIGNED_IN" || (event === "INITIAL_SESSION" && session?.user)) {
      startDashboardPolling();
      loadDashboard().catch((err) => {
        logger.error("[Dashboard] loadDashboard failed:", err);
        renderDashboardError(err);
      });
    }
  });
}

async function loadDashboard() {
  if (loadDashboard._inFlight) return loadDashboard._inFlight;
  loadDashboard._inFlight = (async () => {
  showLoading();

  try {
    const [events, connections] = await Promise.all([
      fetchMyEvents(),
      fetchMyConnections(),
    ]);
    const currentProfileId = await fetchCurrentProfileId();
    const [seeAgainOpportunities, recommendations] = await Promise.all([
      fetchUpcomingEventsForConnections(connections, currentProfileId),
      buildRecommendedEvents(connections, currentProfileId),
    ]);
    logger.log("[Dashboard] events loaded:", events.length);
    const eventIds = events.map((e) => e.id);

    const [counts, intentsByEvent] = await Promise.all([
      eventIds.length ? fetchAttendeeCounts(eventIds) : Promise.resolve(new Map()),
      eventIds.length ? fetchIntentDistribution(eventIds) : Promise.resolve(new Map()),
    ]);

    renderEcosystemHero(events, counts, intentsByEvent);
    renderNetworkMemoryWidget(connections, events);
    renderRecommendedForYouWidget(recommendations);
    renderSeeAgainWidget(seeAgainOpportunities);
    renderDashboard(events, counts, intentsByEvent, buildRelationshipReasonMap(seeAgainOpportunities));
  } catch (err) {
    logger.error("[Dashboard] failed to load dashboard:", err);
    renderDashboardError(err);
  }
  })().finally(() => { loadDashboard._inFlight = null; });
  return loadDashboard._inFlight;
}

function startDashboardPolling() {
  pollingCoordinator.register({
    key: DASHBOARD_EVENTS_POLL_KEY,
    intervalMs: 30000,
    immediate: false,
    run: async () => {
      await refreshDashboard();
    },
  });
}

// ─── Action handlers ──────────────────────────────────────────────────────────

function toggleOverflowMenu(triggerBtn) {
  const menu = triggerBtn.closest(".cc-overflow-wrap")?.querySelector(".cc-overflow-menu");
  if (!menu) return;
  const opening = menu.hidden;
  document.querySelectorAll(".cc-overflow-menu").forEach((m) => { m.hidden = true; });
  menu.hidden = !opening;
}

async function handleCopyLink(btn, url) {
  const ok   = await copyText(url);
  const orig = btn?.textContent;
  if (btn) {
    btn.textContent = ok ? "Copied!" : "Failed";
    setTimeout(() => { btn.textContent = orig; }, 1400);
  }
  trackAppCtaClick("dashboard_copy_link");
}

async function handleEndEvent(eventId, eventName) {
  if (!confirm(`End "${eventName}"?\n\nThis marks the event as finished. Attendees can still view their post-event report.`)) return;
  const { error } = await endEvent(eventId);
  if (error) { logger.error("[Dashboard] endEvent error:", error); alert("Could not end this event. Please try again."); return; }
  await refreshDashboard();
}

async function handleArchive(eventId, eventName) {
  if (!confirm(`Archive "${eventName}"?\n\nIt will be removed from your dashboard. This cannot be undone.`)) return;
  const { error } = await deleteEvent(eventId);
  if (error) { logger.error("[Dashboard] archiveEvent error:", error); alert("Could not archive this event. Please try again."); return; }
  await refreshDashboard();
}

// ─── Handler wiring ───────────────────────────────────────────────────────────

function bindStaticHandlers() {
  // Landing
  document.getElementById("landingSignInBtn")
    ?.addEventListener("click", handleSignInClick);

  // Dashboard header
  document.getElementById("openCreateModalBtn")
    ?.addEventListener("click", openCreateModal);

  // Create modal
  document.getElementById("closeCreateModalBtn")
    ?.addEventListener("click", closeCreateModal);
  document.getElementById("createEventForm")
    ?.addEventListener("submit", handleCreateSubmit);
  document.getElementById("ceEventName")
    ?.addEventListener("input", () => {
      document.getElementById("ceEventNameError").style.display = "none";
      document.getElementById("ceEventName").classList.remove("field-invalid");
      // Auto-fill slug from name only while slug field is empty
      const slugEl = document.getElementById("ceSlug");
      if (slugEl && !slugEl.dataset.userEdited) {
        slugEl.value = slugify(document.getElementById("ceEventName").value.trim());
      }
    });
  document.getElementById("ceSlug")
    ?.addEventListener("input", (e) => {
      e.target.dataset.userEdited = e.target.value ? "1" : "";
      document.getElementById("ceSlugError").style.display = "none";
      e.target.classList.remove("field-invalid");
    });

  // QR modal buttons
  document.getElementById("closeQrModalBtn")
    ?.addEventListener("click", closeQrModal);
  document.getElementById("qrModalCloseBtn")
    ?.addEventListener("click", closeQrModal);
  document.getElementById("qrModalCopyBtn")
    ?.addEventListener("click", (e) => copyCurrentJoinLink(e.currentTarget));

  // Backdrop dismiss
  document.getElementById("createEventModal")
    ?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeCreateModal(); });
  document.getElementById("qrModal")
    ?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeQrModal(); });

  // ESC
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("qrModal")?.hidden)               closeQrModal();
    else if (!document.getElementById("createEventModal")?.hidden) closeCreateModal();
    else document.querySelectorAll(".cc-overflow-menu").forEach((m) => { m.hidden = true; });
  });

  // Event card delegation (show-qr, copy-link, end-event, archive, toggle-overflow)
  document.getElementById("eventCardList")
    ?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, eventId, eventName, joinUrl, url } = btn.dataset;
      switch (action) {
        case "show-qr":         openQrModal(eventId, eventName, joinUrl); break;
        case "copy-link":       await handleCopyLink(btn, url); break;
        case "end-event":       await handleEndEvent(eventId, eventName); break;
        case "archive":         await handleArchive(eventId, eventName); break;
        case "toggle-overflow": toggleOverflowMenu(btn); e.stopPropagation(); break;
      }
    });

  // Close all overflow menus when clicking outside
  document.addEventListener("click", () => {
    document.querySelectorAll(".cc-overflow-menu").forEach((m) => { m.hidden = true; });
  });
}

// ─── Live Mode extension point ────────────────────────────────────────────────

/**
 * Reveal the Live Mode panel for a given event card and return the element.
 * Call this from a future live-mode.js module when activating realtime:
 *
 *   import { getLivePanelEl } from "./dashboard.js";
 *   const panel = getLivePanelEl(eventId);
 *   panel.innerHTML = "...anchor status, attendees, intelligence...";
 */
export function getLivePanelEl(eventId) {
  const panel = document.getElementById(`cc-live-${eventId}`);
  if (panel) panel.hidden = false;
  return panel;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initAnalytics() {
  patchAppStoreLinks();
  trackPageView();
}

document.addEventListener("DOMContentLoaded", () => {
  logger.log("[Dashboard] DOMContentLoaded");
  initAnalytics();
  initDashboard();
});
