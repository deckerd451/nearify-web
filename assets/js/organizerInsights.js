/**
 * organizerInsights.js — Read-only aggregate insights for event organizers.
 *
 * Privacy model:
 *   Aggregate counts only. No individual names or profile-identifying data.
 *   Reads: server-authorized aggregate RPC only.
 *   Never reads: interaction_events, BLE traces, encounter history.
 *   Access enforced by RPC via events.created_by and auth.uid().
 */
import { supabase } from "./supabaseClient.js";
import { logger } from "./logger.js";

const INTENT_LABELS = {
  meet_people:    "Meet people",
  find_cofounder: "Find a cofounder",
  hire:           "Hire",
  explore_ideas:  "Explore ideas",
  demo_something: "Demo something",
};

// ---- Data layer ----
// The database RPC independently checks events.created_by against auth.uid()
// and returns aggregates only. No raw attendee or profile rows reach the browser.
async function fetchInsightsData(eventId) {
  const { data, error } = await supabase.rpc("get_organizer_event_insights", {
    p_event_id: eventId,
  });
  if (error || !data || typeof data !== "object") {
    logger.error("[OrgInsights] aggregate RPC unavailable:", error);
    return null;
  }
  if (data.suppressed === true) return { suppressed: true };
  const pairs = (value) => Array.isArray(value)
    ? value.filter((pair) => Array.isArray(pair) && pair.length === 2 &&
        typeof pair[0] === "string" && Number.isFinite(Number(pair[1])))
        .map(([key, count]) => [key, Number(count)])
    : [];
  return {
    suppressed: false,
    total: Number(data.total) || 0,
    withGoals: Number(data.withGoals) || 0,
    sortedGoals: pairs(data.sortedGoals),
    topInterests: pairs(data.topInterests),
    topSkills: pairs(data.topSkills),
  };
}

// ---- Natural language summary ----

function generateSummary(eventName, { total, sortedGoals, topInterests }) {
  if (!total) return null;

  let sentence = `${eventName || "This event"} attracted ${total} attendee${total !== 1 ? "s" : ""}`;

  if (sortedGoals.length) {
    const topLabels = sortedGoals.slice(0, 2).map(([k]) => (INTENT_LABELS[k] || k).toLowerCase());
    sentence += topLabels.length === 1
      ? ` focused on ${topLabels[0]}`
      : ` focused on ${topLabels[0]} and ${topLabels[1]}`;
  }

  if (topInterests.length >= 2) {
    const top3 = topInterests.slice(0, 3).map(([k]) => k);
    const phrase = top3.length < 3
      ? top3.join(" and ")
      : `${top3[0]}, ${top3[1]}, and ${top3[2]}`;
    return `${sentence}, with strong overlap across ${phrase}.`;
  }

  return `${sentence}.`;
}

// ---- DOM helpers ----

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function textEl(tag, className, content) {
  const e = el(tag, className);
  e.textContent = content;
  return e;
}

// ---- Card builders ----

function buildSummaryCard(eventName, metrics) {
  const summary = generateSummary(eventName, metrics);
  if (!summary) return null;
  const card = el("div", "organizer-summary");
  card.textContent = `"${summary}"`;
  return card;
}

function buildParticipationCard({ total, withGoals }) {
  const pct = total ? Math.round((withGoals / total) * 100) : 0;

  const card = el("div", "organizer-card");
  card.appendChild(textEl("div", "organizer-card-title", "Participation"));
  card.appendChild(textEl("div", "organizer-stat", String(total)));
  card.appendChild(textEl("div", "organizer-stat-label", `attendee${total !== 1 ? "s" : ""} joined`));

  const sub = el("div", "organizer-stat-sub");
  sub.textContent = `${withGoals} with goals set`;
  if (total) {
    const badge = el("span", "organizer-pct");
    badge.textContent = ` · ${pct}%`;
    sub.appendChild(badge);
  }
  card.appendChild(sub);

  const track = el("div", "organizer-bar-track");
  const fill = el("div", "organizer-bar-fill");
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  card.appendChild(track);

  return card;
}

function buildGoalDistCard({ sortedGoals, total }) {
  const card = el("div", "organizer-card");
  card.appendChild(textEl("div", "organizer-card-title", "What they're here for"));

  if (!sortedGoals.length) {
    card.appendChild(textEl("p", "organizer-empty-note", "No goals set yet."));
    return card;
  }

  const maxCount = sortedGoals[0][1];
  for (const [key, count] of sortedGoals) {
    const row = el("div", "organizer-goal-row");

    const meta = el("div", "organizer-goal-meta");
    meta.appendChild(textEl("span", "organizer-goal-label", INTENT_LABELS[key] || key));
    const pct = total ? Math.round((count / total) * 100) : 0;
    meta.appendChild(textEl("span", "organizer-goal-count", `${count} · ${pct}%`));
    row.appendChild(meta);

    const track = el("div", "organizer-bar-track");
    const fill = el("div", "organizer-bar-fill");
    fill.style.width = `${Math.round((count / maxCount) * 100)}%`;
    track.appendChild(fill);
    row.appendChild(track);

    card.appendChild(row);
  }

  return card;
}

function buildTagCard(title, entries) {
  const card = el("div", "organizer-card");
  card.appendChild(textEl("div", "organizer-card-title", title));

  const cloud = el("div", "organizer-tag-cloud");
  for (const [tag, count] of entries) {
    const pill = el("span", "organizer-tag");
    pill.appendChild(document.createTextNode(tag + " "));
    pill.appendChild(textEl("span", "organizer-tag-count", String(count)));
    cloud.appendChild(pill);
  }
  card.appendChild(cloud);
  return card;
}

// ---- Main render ----

function renderInsights(mount, event, metrics) {
  mount.innerHTML = "";

  // Heading
  const headingDiv = el("div", "section-heading");
  const h2Row = el("div", "organizer-heading-row");
  const h2 = textEl("h2", null, "Organizer Insights");
  const badge = textEl("span", "organizer-badge", "Organizer");
  h2Row.appendChild(h2);
  h2Row.appendChild(badge);
  headingDiv.appendChild(h2Row);
  headingDiv.appendChild(
    textEl("p", null, "Aggregate participation data for this event. Visible only to you.")
  );
  mount.appendChild(headingDiv);

  if (!metrics.total) {
    mount.appendChild(
      textEl("div", "organizer-empty", "No attendees have joined yet. Insights will appear once people start joining.")
    );
    return;
  }

  // Natural-language summary
  const summaryCard = buildSummaryCard(event.name, metrics);
  if (summaryCard) mount.appendChild(summaryCard);

  // Top row: participation + goal distribution
  const topGrid = el("div", "organizer-grid");
  topGrid.appendChild(buildParticipationCard(metrics));
  topGrid.appendChild(buildGoalDistCard(metrics));
  mount.appendChild(topGrid);

  // Bottom row: interests + skills
  if (metrics.topInterests.length || metrics.topSkills.length) {
    const bottomGrid = el("div", "organizer-grid");
    if (metrics.topInterests.length) bottomGrid.appendChild(buildTagCard("Interests", metrics.topInterests));
    if (metrics.topSkills.length) bottomGrid.appendChild(buildTagCard("Skills", metrics.topSkills));
    mount.appendChild(bottomGrid);
  }
}

// ---- Public API ----

export async function loadOrganizerInsights(event) {
  const mount = document.getElementById("organizerInsightsMount");
  if (!mount) return;

  mount.innerHTML = "";
  mount.appendChild(textEl("div", "organizer-loading", "Loading insights…"));

  const raw = await fetchInsightsData(event.id);
  if (!raw) {
    mount.innerHTML = "";
    mount.appendChild(textEl("div", "organizer-empty", "Could not load insights. Please refresh."));
    return;
  }

  if (raw.suppressed) {
    mount.innerHTML = "";
    mount.appendChild(textEl("div", "organizer-empty",
      "Insights are hidden for small events to protect attendee privacy."));
    return;
  }
  renderInsights(mount, event, raw);
}
