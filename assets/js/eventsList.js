/**
 * eventsList.js — Public events listing page logic
 *
 * Fetches public events, splits into upcoming/past, renders cards
 * with attendee counts and momentum indicators.
 *
 * Loaded by /events/index.html as a module.
 */

import { fetchPublicEvents } from "./events.js";
import { supabase } from "./supabaseClient.js";
import { escapeHtml } from "./utils.js";

const upcomingGrid = document.getElementById("eventsListGrid");
const pastSection = document.getElementById("pastEventsSection");
const pastGrid = document.getElementById("pastEventsGrid");

async function fetchAttendeeMeta(eventIds) {
  if (!eventIds.length) return { counts: new Map(), intents: new Map() };
  const { data, error } = await supabase
    .from("event_attendees")
    .select("event_id, intent_primary")
    .in("event_id", eventIds);
  if (error || !data) return { counts: new Map(), intents: new Map() };

  const counts = new Map();
  const intents = new Map();
  for (const row of data) {
    counts.set(row.event_id, (counts.get(row.event_id) || 0) + 1);
    if (row.intent_primary) {
      if (!intents.has(row.event_id)) intents.set(row.event_id, {});
      const m = intents.get(row.event_id);
      m[row.intent_primary] = (m[row.intent_primary] || 0) + 1;
    }
  }
  return { counts, intents };
}

function buildFlavorText(intentMap, count) {
  if (!intentMap || count < 3) return "";
  const labels = {
    meet_people: "Networkers",
    find_cofounder: "Builders",
    hire: "Hiring",
    explore_ideas: "Explorers",
    demo_something: "Demos",
  };
  const sorted = Object.entries(intentMap)
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c >= 2 && c / count >= 0.2);
  if (sorted.length >= 2) return labels[sorted[0][0]] + " + " + labels[sorted[1][0]];
  if (sorted.length === 1 && sorted[0][1] >= 3) return labels[sorted[0][0]];
  return "";
}

function renderCard(ev, { featured = false, past = false, count = 0, intentMap = null } = {}) {
  const dateTimeStr = ev.starts_at
    ? new Date(ev.starts_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : "";
  const meta = [ev.location, dateTimeStr].filter(Boolean).join(" \u00b7 ");
  const desc = ev.description
    ? '<p class="event-list-desc">' + escapeHtml(ev.description) + '</p>'
    : "";
  const detailUrl = ev.slug
    ? "event.html?slug=" + encodeURIComponent(ev.slug)
    : "event.html?id=" + encodeURIComponent(ev.id);
  const nameHtml = '<a href="' + detailUrl + '" class="event-list-name-link">' + escapeHtml(ev.name) + '</a>';
  const cardClass = "event-list-card" + (featured ? " featured" : "") + (past ? " event-card-past" : "");
  const badge = featured
    ? '<div class="card-badge">Featured</div>'
    : past
      ? '<div class="card-badge card-badge-past">Past</div>'
      : "";

  // Momentum line
  let momentumHtml = "";
  if (count > 0) {
    const countLabel = past ? count + " attended" : count + " attending";
    const flavor = !past ? buildFlavorText(intentMap, count) : "";
    momentumHtml = '<div class="event-card-momentum">' +
      '<span class="momentum-count">' + escapeHtml(countLabel) + '</span>' +
      (flavor ? '<span class="momentum-flavor">' + escapeHtml(flavor) + '</span>' : '') +
      '</div>';
  }

  return '<article class="' + cardClass + '" data-event-id="' + ev.id + '">' +
    badge +
    '<h3>' + nameHtml + '</h3>' +
    (meta ? '<p class="event-list-meta">' + escapeHtml(meta) + '</p>' : "") +
    momentumHtml +
    desc +
    '<div class="event-card-actions">' +
      '<a href="' + detailUrl + '" class="btn primary">View Event</a>' +
    '</div>' +
  '</article>';
}

async function loadEvents() {
  if (!upcomingGrid) return;

  let events;
  try {
    events = await fetchPublicEvents();
  } catch (err) {
    upcomingGrid.innerHTML =
      '<p style="text-align:center; color:#f87171;">Could not load events. Please refresh and try again.</p>';
    return;
  }

  const allIds = (events || []).map(ev => ev.id);
  const { counts, intents } = await fetchAttendeeMeta(allIds);

  const now = new Date();
  const upcoming = (events || []).filter(ev => !ev.starts_at || new Date(ev.starts_at) >= now);
  const past = (events || [])
    .filter(ev => ev.starts_at && new Date(ev.starts_at) < now)
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

  // Upcoming
  if (!upcoming.length) {
    upcomingGrid.innerHTML =
      '<p style="text-align:center; color:#8fa0b8;">No upcoming events scheduled. Check back soon.</p>';
  } else {
    upcomingGrid.innerHTML = upcoming
      .map((ev, i) => renderCard(ev, {
        featured: i === 0,
        count: counts.get(ev.id) || 0,
        intentMap: intents.get(ev.id) || null
      }))
      .join("");
  }

  // Past
  if (past.length && pastSection && pastGrid) {
    pastGrid.innerHTML = past.map(ev => renderCard(ev, {
      past: true,
      count: counts.get(ev.id) || 0,
      intentMap: intents.get(ev.id) || null
    })).join("");
    pastSection.style.display = "";
  }
}

loadEvents();
