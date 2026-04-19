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
  { min: 45, dots: 2, label: "Good signal" },
  { min: 0, dots: 1, label: "Mild signal" },
];

const EPSILON = 0.0001;

const DECISION_ACTIONS = [
  "suggest_connect",
  "suggest_follow_up",
  "suggest_find",
  "suggest_rejoin",
  "suggest_explore",
  "do_nothing",
];

const EL_ACTIONS = [
  "suggest_connect",
  "suggest_follow_up",
  "suggest_find",
  "suggest_rejoin",
  "suggest_explore",
  "do_nothing",
];

function scoreToStrength(score) {
  return STRENGTH_LEVELS.find((l) => score >= l.min) ?? STRENGTH_LEVELS[2];
}

function renderStrengthDots(dots) {
  return [1, 2, 3]
    .map((i) => `<span class="intel-dot ${i <= dots ? "filled" : "empty"}"></span>`)
    .join("");
}

function getInitials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str ?? "");
  return d.innerHTML;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sumBy(items, fn) {
  return items.reduce((acc, item) => acc + fn(item), 0);
}

function normalizeSignals(rows) {
  const total = rows.length || 1;
  const recommended = rows.filter((r) => r.type === "recommended");
  const followUp = rows.filter((r) => r.type === "follow_up");
  const missed = rows.filter((r) => r.type === "missed");
  const incoming = rows.filter((r) => r.direction === "incoming");
  const avgScore = clamp01(sumBy(rows, (r) => Number(r.score) || 0) / (total * 100));
  const maxScore = clamp01(Math.max(...rows.map((r) => Number(r.score) || 0), 0) / 100);
  const sharedIntentHits = rows.filter((r) => /shared intent/i.test(r.reason || "")).length;

  const P = clamp01(maxScore);
  const X = clamp01((recommended.length * 0.9 + followUp.length * 0.6 + missed.length * 0.3) / total);
  const N = clamp01((avgScore + maxScore) / 2);
  const O = clamp01((sharedIntentHits / total) * 0.8 + (recommended.length / total) * 0.2);
  const K = clamp01((followUp.length / total) * 0.7 + (recommended.length / total) * 0.3);
  const L = clamp01((missed.length / total) * 0.5 + (sharedIntentHits / total) * 0.5);
  const T = clamp01(1 - Math.min(1, rows.length / 8));
  const F_r = clamp01(0.2 + (followUp.length / total) * 0.3);
  const Q = clamp01(1 - (rows.length > 0 ? avgScore : 0));

  return {
    signals: { P, X, N, O, K, L, T, F_r, Q },
    meta: {
      total,
      recommendedRatio: clamp01(recommended.length / total),
      followUpRatio: clamp01(followUp.length / total),
      missedRatio: clamp01(missed.length / total),
      incomingRatio: clamp01(incoming.length / total),
    },
  };
}

function computeBaseComponents(signals) {
  const g0 = clamp01(0.45 * signals.P + 0.35 * signals.X + 0.2 * signals.N);
  const g1 = clamp01(0.4 * signals.O + 0.35 * signals.K + 0.25 * signals.L);
  const e = clamp01(0.45 * signals.T + 0.3 * signals.F_r + 0.25 * signals.Q);
  return { g0, g1, e };
}

function getActionComponentFactors(action, meta, signals) {
  const common = {
    c: clamp01(1 - signals.Q),
    r_g: clamp01(0.5 + meta.recommendedRatio * 0.5),
  };

  switch (action) {
    case "suggest_connect":
      return { ...common, a_s: clamp01(0.7 + meta.recommendedRatio * 0.3), r: 0.15, v: 0.1, m: 0.2 };
    case "suggest_follow_up":
      return { ...common, a_s: clamp01(0.45 + meta.followUpRatio * 0.55), r: 0.2, v: 0.15, m: 0.2 };
    case "suggest_find":
      return { ...common, a_s: clamp01(0.35 + meta.missedRatio * 0.65), r: 0.25, v: 0.2, m: 0.15 };
    case "suggest_rejoin":
      return { ...common, a_s: clamp01(0.3 + meta.incomingRatio * 0.7), r: 0.35, v: 0.2, m: 0.1 };
    case "suggest_explore":
      return { ...common, a_s: clamp01(0.25 + signals.O * 0.75), r: 0.2, v: 0.25, m: 0.1 };
    case "do_nothing":
    default:
      return { ...common, a_s: 0, r: 0, v: 0, m: 0 };
  }
}

export function computeNextBestAction(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      action: "do_nothing",
      score: 0,
      confidence: 0,
      components: { g0: 0, g1: 0, e: 0, a_s: 0, c: 0, r_g: 0, r: 0, v: 0, m: 0 },
      signals: { P: 0, X: 0, N: 0, O: 0, K: 0, L: 0, T: 1, F_r: 1, Q: 1 },
      policy: { H: 0, reason: "no_rows" },
    };
  }

  const { signals, meta } = normalizeSignals(rows);
  const { g0, g1, e } = computeBaseComponents(signals);
  const confidence = clamp01(((g0 + g1) / 2) * (1 - signals.Q * 0.5));
  const risk = clamp01(0.4 * signals.Q + 0.35 * signals.T + 0.25 * signals.F_r);
  const cooldown = 0;

  let best = {
    action: "do_nothing",
    score: 0,
    confidence,
    components: { g0, g1, e, a_s: 0, c: 0, r_g: 0, r: 0, v: 0, m: 0 },
    signals,
    policy: { H: 1, reason: "baseline" },
  };

  for (const action of DECISION_ACTIONS) {
    if (action === "do_nothing") continue;

    const factors = getActionComponentFactors(action, meta, signals);
    const pathExists = rows.length > 0 ? 1 : 0;
    const H = confidence >= 0.3 && risk <= 0.75 && cooldown === 0 && pathExists === 1 ? 1 : 0;
    const phi =
      H === 0
        ? Number.NEGATIVE_INFINITY
        : (((g0 + g1) / (e + EPSILON)) * factors.a_s * factors.c * factors.r_g) -
          0.5 * factors.r -
          0.35 * factors.v -
          0.2 * factors.m;

    if (phi > best.score) {
      best = {
        action,
        score: Number(phi.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        components: { g0, g1, e, ...factors },
        signals,
        policy: { H, reason: H ? "eligible" : "gated" },
      };
    }
  }

  return best;
}

function renderDecisionDebug(decision) {
  const wrap = document.createElement("details");
  wrap.className = "intel-decision-debug";
  wrap.innerHTML = `
    <summary>Next-best action: ${escapeHtml(decision.action)}</summary>
    <pre>${escapeHtml(JSON.stringify(decision, null, 2))}</pre>
  `;
  return wrap;
}

export function appendDecisionDebug(container, decision) {
  if (!container) return;
  container.querySelectorAll(".intel-decision-debug").forEach((el) => el.remove());
  container.appendChild(renderDecisionDebug(decision));
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

  const statusClass = hasData ? "intel-status-ready" : "intel-status-pending";
  const statusText = hasData ? "Ready" : "Report pending";

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
  let r = reason
    .trim()
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

  const missedHint =
    item.type === "missed"
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

async function resolveCurrentProfileId() {
  const user = await getCurrentUser();
  if (!user?.id) return null;

  const { data, error } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();

  if (error) return null;
  return data?.id ?? null;
}

function computeSharedInterestScore(currentProfile, peerProfiles) {
  const toSet = (obj) => {
    if (!obj || typeof obj !== "object") return new Set();

    const raw = obj.interests ?? obj.tags ?? obj.topics ?? obj.intent_secondary ?? [];
    const arr = Array.isArray(raw) ? raw : [];
    return new Set(arr.map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  };

  const mine = toSet(currentProfile);
  if (mine.size === 0 || !peerProfiles.length) return 0;

  let overlapTotal = 0;
  for (const peer of peerProfiles) {
    const theirs = toSet(peer);
    if (theirs.size === 0) continue;
    const overlap = [...mine].filter((x) => theirs.has(x)).length;
    overlapTotal += overlap / Math.max(1, Math.min(mine.size, theirs.size));
  }

  return clamp01(overlapTotal / peerProfiles.length);
}

function actionSuitability(action, s) {
  switch (action) {
    case "suggest_connect":
      return 0.5 + 0.4 * s.P + 0.1 * s.O;
    case "suggest_follow_up":
      return 0.5 + 0.4 * s.X + 0.1 * s.N;
    case "suggest_find":
      return 0.4 + 0.4 * s.O + 0.2 * (1 - s.X);
    case "suggest_rejoin":
      return 0.4 + 0.4 * (1 - s.N) + 0.2 * s.P;
    case "suggest_explore":
      return 0.5 + 0.3 * (1 - s.O) + 0.2 * s.N;
    case "do_nothing":
      return 0.3 + 0.7 * (1 - s.P);
    default:
      return 0.5;
  }
}

/**
 * Fetch raw interaction signals and compute next-best-action.
 * Never modifies RPC/UI behavior; this is additive fallback intelligence.
 *
 * @param {string} eventId
 * @returns {Promise<{action:string, score:number, confidence:number, components:object}>}
 */
export async function fetchRawSignals(eventId) {
  const fallback = {
    action: "do_nothing",
    score: 0,
    confidence: 0,
    components: { P: 0, X: 0, O: 0, N: 0, note: "no_signals" },
  };

  if (!eventId) return fallback;

  const profileId = await resolveCurrentProfileId();
  if (!profileId) return fallback;

  const [{ data: attendees }, { data: interactions }, { data: profiles }] = await Promise.all([
    supabase
      .from("event_attendees")
      .select("profile_id, intent_primary, intent_secondary, created_at")
      .eq("event_id", eventId),
    supabase
      .from("interaction_events")
      .select("from_profile_id, to_profile_id, interaction_type, strength, dwell_seconds, signal_strength, created_at")
      .eq("event_id", eventId)
      .or(`from_profile_id.eq.${profileId},to_profile_id.eq.${profileId}`),
    supabase.from("profiles").select("*"),
  ]);

  const attendeeRows = attendees || [];
  const interactionRows = interactions || [];
  const profileRows = profiles || [];
  const attendeeIds = new Set(attendeeRows.map((a) => a.profile_id));
  const relevantProfiles = profileRows.filter((p) => attendeeIds.has(p.id));
  const me = relevantProfiles.find((p) => p.id === profileId);
  const peers = relevantProfiles.filter((p) => p.id !== profileId);

  if (!attendeeRows.length && !interactionRows.length) {
    console.log("[EL] action:", fallback.action);
    console.log("[EL] score:", fallback.score);
    console.log("[EL] components:", fallback.components);
    return fallback;
  }

  const coPresent = attendeeIds.has(profileId) ? 1 : 0;
  const rawStrength = interactionRows.reduce((acc, r) => {
    const qrBoost = r.interaction_type === "qr_confirmed" ? 0.5 : 0;
    const dwell = Math.min(1, (Number(r.dwell_seconds) || 0) / 300);
    const s = clamp01((Number(r.strength) || 0) / 100);
    const sig = clamp01((Number(r.signal_strength) || 0) / 100);
    return acc + 0.5 * dwell + 0.25 * s + 0.25 * sig + qrBoost;
  }, 0);

  const P = clamp01(coPresent);
  const X = clamp01(rawStrength / Math.max(1, interactionRows.length));
  const O = computeSharedInterestScore(me, peers);

  const latestTs = interactionRows.reduce((maxTs, r) => {
    const ts = r.created_at ? new Date(r.created_at).getTime() : 0;
    return Math.max(maxTs, ts);
  }, 0);

  const ageHours = latestTs ? (Date.now() - latestTs) / (1000 * 60 * 60) : 72;
  const N = clamp01(1 - ageHours / 72);

  const signals = { P, X, O, N };
  const epsilon = 0.001;
  const g0 = P;
  const g1 = X;
  const e = 1 - O;
  const c = clamp01((Number(!!me) + Number(peers.length > 0) + Number(interactionRows.length > 0)) / 3);
  const r_g = N;
  const alpha = 0.25;
  const beta = 0.2;
  const delta = 0.2;
  const r = 1 - X;
  const v = Math.abs(P - X);
  const m = 1 - O;

  const scored = EL_ACTIONS.map((action) => {
    const a_s = clamp01(actionSuitability(action, signals));
    const score = (((g0 + g1) / (e + epsilon)) * a_s * c * r_g) - alpha * r - beta * v - delta * m;
    return { action, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0] || { action: "do_nothing", score: 0 };
  const confidence = clamp01(c * (0.5 + 0.5 * Math.max(P, X, O, N)));
  const result = {
    action: best.action,
    score: Number(best.score.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    components: {
      ...signals,
      g0,
      g1,
      e,
      epsilon,
      c,
      r_g,
      alpha,
      beta,
      delta,
      r,
      v,
      m,
      scored_actions: scored.map((s) => ({
        action: s.action,
        score: Number(s.score.toFixed(4)),
      })),
    },
  };

  console.log("[EL] action:", result.action);
  console.log("[EL] score:", result.score);
  console.log("[EL] components:", result.components);
  return result;
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

  if (!data || data.length === 0) {
    const fallback = await fetchRawSignals(eventId);
    console.log("[Intelligence] EL fallback:", fallback);
  }

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
    const { data, error } = await supabase.from("events").select("name, starts_at").eq("id", eventId).maybeSingle();

    if (error || !data) return null;

    return {
      name: data.name,
      date: data.starts_at
        ? new Date(data.starts_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
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

    const fallbackDecision = computeNextBestAction([]);
    console.info("[Intelligence] next_best_action", fallbackDecision);
    appendDecisionDebug(container, fallbackDecision);

    container.style.display = "";
    return;
  }

  const decision = computeNextBestAction(data);
  console.info("[Intelligence] next_best_action", decision);

  const buckets = {
    recommended: { title: "Strongest interactions", items: [] },
    follow_up: { title: "People you met", items: [] },
    missed: { title: "You missed", items: [] },
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

  appendDecisionDebug(container, decision);
  container.style.display = "";
}
