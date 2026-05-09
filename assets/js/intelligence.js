/**
 * intelligence.js — DOM rendering and Supabase data layer
 *
 * Pure computation lives in intelligence-algo.js (no DOM, fully testable).
 * This module owns: card rendering, CTA wiring, data fetching.
 */
import { supabase } from "./supabaseClient.js";
import { getCurrentUser } from "./appState.js";
import { escapeHtml, escapeAttr } from "./utils.js";
import {
  DECISION_ACTIONS,
  EL_ACTIONS,
  PRESENTATION_STATES,
  clamp01,
  computeNextBestAction,
  getDecisionSignals,
  shouldPromoteFallbackDecision,
  hasMeaningfulFallbackDecision,
  buildPostEventSummary,
  buildSignalInsights,
  normalizeIntent,
  computeIntentAlignment,
  computeSharedInterestScore,
  actionSuitability,
  getPresentationState,
  getStateCopy,
} from "./intelligence-algo.js";
import { logger } from "./logger.js";

export { computeNextBestAction, shouldPromoteFallbackDecision, hasMeaningfulFallbackDecision };

// ---------------------------------------------------------------------------
// DOM utilities (rendering-only helpers)
// ---------------------------------------------------------------------------

const DIRECTION_LABELS = {
  incoming: "They noticed you",
  outgoing: "You crossed paths",
};

const STRENGTH_LEVELS = [
  { min: 75, dots: 3, label: "Strong match" },
  { min: 45, dots: 2, label: "Good signal" },
  { min: 0,  dots: 1, label: "Mild signal" },
];

const STATIC_PROFILE_ROUTE = "/profile.html";

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
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

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

function isDebugModeEnabled() {
  return localStorage.getItem("nearify_intel_debug") === "1";
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

export function renderIntelCard(item) {
  const card = document.createElement("div");
  card.className = "intel-card";

  const initials = getInitials(item.target_name);

  // Avatar — use DOM so pre-built HTML fragments never touch innerHTML
  if (item.target_avatar) {
    const img = document.createElement("img");
    img.className = "intel-avatar";
    img.src = item.target_avatar;
    img.alt = initials;
    card.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "intel-avatar intel-avatar-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = initials;
    card.appendChild(placeholder);
  }

  const body = document.createElement("div");
  body.className = "intel-card-body";

  const nameEl = document.createElement("div");
  nameEl.className = "intel-card-name";
  nameEl.textContent = item.target_name || "Attendee";
  body.appendChild(nameEl);

  const directionText  = DIRECTION_LABELS[item.direction] ?? "Interaction";
  const directionClass = item.direction === "incoming" ? "incoming" : "outgoing";
  const dirLabel = document.createElement("span");
  dirLabel.className = `intel-direction ${directionClass}`;
  dirLabel.textContent = directionText;
  body.appendChild(dirLabel);

  const reasonEl = document.createElement("div");
  reasonEl.className = "intel-card-reason";
  reasonEl.textContent = normalizeReason(item.reason);
  body.appendChild(reasonEl);

  const strength = scoreToStrength(Math.round(item.score ?? 0));
  const strengthEl = document.createElement("div");
  strengthEl.className = "intel-strength";
  const dotsSpan = document.createElement("span");
  dotsSpan.className = "intel-dots";
  dotsSpan.innerHTML = renderStrengthDots(strength.dots); // only hardcoded class names + numbers
  strengthEl.appendChild(dotsSpan);
  const strengthLabelEl = document.createElement("span");
  strengthLabelEl.className = "intel-strength-label";
  strengthLabelEl.textContent = strength.label;
  strengthEl.appendChild(strengthLabelEl);
  body.appendChild(strengthEl);

  if (item.type === "missed") {
    const hint = document.createElement("p");
    hint.className = "intel-missed-hint";
    hint.textContent = "You were near each other but didn't connect — worth a reach-out.";
    body.appendChild(hint);
  }

  card.appendChild(body);
  return card;
}

// ---------------------------------------------------------------------------
// Event header
// ---------------------------------------------------------------------------

function buildEventHeader(eventMeta, state) {
  const header = document.createElement("div");
  header.className = "intel-event-header";

  const datePart    = eventMeta.date
    ? `<span class="intel-event-date"> · ${escapeHtml(eventMeta.date)}</span>`
    : "";
  const statusClass = state === PRESENTATION_STATES.POST_EVENT_SUMMARY ? "intel-status-ready" : "intel-status-pending";
  const statusText  = state === PRESENTATION_STATES.POST_EVENT_SUMMARY
    ? "Ready"
    : state === PRESENTATION_STATES.EARLY_SIGNAL ? "Early signal" : "No signal yet";

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

// ---------------------------------------------------------------------------
// Post-event summary block
// ---------------------------------------------------------------------------

function renderPostEventSummary(container, decision, hasData, state) {
  const stateCopy = getStateCopy(state);
  const titleText = stateCopy.title;
  const bodyText  = state === PRESENTATION_STATES.POST_EVENT_SUMMARY
    ? stateCopy.body
    : stateCopy.body || buildPostEventSummary(decision, hasData);

  const summary = document.createElement("div");
  summary.className = "intel-post-summary";
  summary.innerHTML = `
    <p class="intel-post-summary-title">${escapeHtml(titleText)}</p>
    <p class="intel-post-summary-body">${escapeHtml(bodyText)}</p>
  `;
  container.appendChild(summary);

  if (state === PRESENTATION_STATES.NO_SIGNAL) return;

  const insights = buildSignalInsights(decision);
  if (!insights.length) return;

  const insightsList = document.createElement("ul");
  insightsList.className = "intel-secondary-insights";
  insights.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "intel-secondary-insight";
    item.innerHTML = `<span class="intel-insight-label">${escapeHtml(entry.label)}:</span> ${escapeHtml(entry.value)}`;
    insightsList.appendChild(item);
  });
  container.appendChild(insightsList);
}

function appendPersistenceSignal(container, state) {
  if (!container) return;
  container.querySelectorAll(".intel-persistence-signal").forEach((node) => node.remove());
  const signal = document.createElement("p");
  signal.className = "intel-persistence-signal";
  signal.textContent = getStateCopy(state).footer;
  container.appendChild(signal);
}

// ---------------------------------------------------------------------------
// CTA / connect flow
// ---------------------------------------------------------------------------

function resolveSuggestedConnectTarget() {
  for (const route of ["/connect/", "/connect", "/join/"]) {
    if (document.querySelector(`a[href='${route}']`)) return { type: "route", target: route };
  }
  const eventId = new URL(window.location.href).searchParams.get("event");
  if (eventId) return { type: "deep-link", target: `beacon://event/${encodeURIComponent(eventId)}` };
  if (window.location.pathname !== "/") return { type: "fallback-url", target: "/" };
  return { type: "fallback-alert", target: "Open Nearify app to connect" };
}

function setConnectFallbackMessage(message = "Open the Nearify app on your phone to continue.") {
  const el = document.querySelector(".intel-recommended-action .intel-recommended-body");
  if (el) el.textContent = message;
}

function getShareableProfileUrl() {
  const current   = new URL(window.location.href);
  const eventId   = current.searchParams.get("event");
  const profileId = current.searchParams.get("profile") || current.searchParams.get("profile_id");
  if (!profileId) return null;
  const url = new URL(STATIC_PROFILE_ROUTE, window.location.origin);
  if (profileId) url.searchParams.set("id", profileId);
  if (eventId)   url.searchParams.set("event", eventId);
  return url.toString();
}

function showConnectFallbackActions(root) {
  if (!root) return;
  const fallback = root.querySelector(".intel-connect-fallback");
  if (fallback) fallback.hidden = false;
}

async function copyProfileLink(profileUrl) {
  if (!profileUrl) return false;
  try { await navigator.clipboard.writeText(profileUrl); return true; } catch { return false; }
}

function handleSuggestConnect(root = null, attemptState = null) {
  const action = resolveSuggestedConnectTarget();
  if (action.type === "route" || action.type === "fallback-url") {
    window.location.assign(action.target);
    return;
  }
  if (action.type === "deep-link") {
    if (attemptState?.hasAttemptedDeepLinkForThisClick) return;
    if (attemptState) attemptState.hasAttemptedDeepLinkForThisClick = true;

    let fallbackUsed = false;
    const fallbackTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        fallbackUsed = true;
        setConnectFallbackMessage();
        showConnectFallbackActions(root);
      }
    }, 1200);

    const clearTimer = () => {
      window.clearTimeout(fallbackTimer);
      document.removeEventListener("visibilitychange", clearTimer);
      window.removeEventListener("pagehide", clearTimer);
    };
    document.addEventListener("visibilitychange", clearTimer);
    window.addEventListener("pagehide", clearTimer);
    window.location.href = action.target;
    window.setTimeout(() => { if (!fallbackUsed) clearTimer(); }, 1500);
    return;
  }
  setConnectFallbackMessage(action.target);
  showConnectFallbackActions(root);
}

function renderRecommendedAction(decision) {
  if (!decision || decision.action !== "suggest_connect" || Number(decision.confidence) <= 0.2) return null;

  const score              = Number(decision.score ?? 0);
  const confidence         = Number(decision.confidence ?? 0);
  const isFallbackDecision = !!decision?.components?.scored_actions;
  const isLowConfidence    = isFallbackDecision && (score < 0 || confidence < 0.5);
  const useStrongLanguage  = decision.action === "suggest_connect" && confidence >= 0.5 && score >= 0;
  const shareableUrl       = getShareableProfileUrl();
  const intent             = normalizeIntent(decision?.components?.intent || localStorage.getItem("intent_primary"));

  const intentReasons = {
    meet_people:    isLowConfidence ? "Possible signal: you may both be looking to meet people." : "You're both looking to meet people.",
    find_cofounder: isLowConfidence ? "Possible signal: you may both be exploring collaboration opportunities." : "You're both exploring collaboration opportunities.",
    hire:           isLowConfidence ? "Possible signal: there may be a hiring match here." : "There may be a strong hiring match here.",
    explore_ideas:  isLowConfidence ? "Possible signal: you may both be exploring ideas." : "You're both exploring ideas.",
    demo:           isLowConfidence ? "Possible signal: one of you may be showcasing something worth seeing." : "One of you is showcasing something worth seeing.",
  };
  const reason = intent
    ? (intentReasons[intent] || (isLowConfidence ? "Possible signal from a relevant interaction." : "You crossed paths through a relevant interaction."))
    : (isLowConfidence ? "Possible signal from a recent interaction." : "You had a recent interaction.");

  const block = document.createElement("div");
  block.className = "intel-recommended-action";

  const title = document.createElement("h3");
  title.className = "intel-recommended-title";
  title.textContent = "Recommended next step";

  const body = document.createElement("p");
  body.className = "intel-recommended-body";
  body.textContent = reason;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "intel-connect-btn";
  button.textContent = useStrongLanguage ? "Open Nearify to connect live" : "Open Nearify to explore this signal";
  button.addEventListener("click", () => handleSuggestConnect(block, { hasAttemptedDeepLinkForThisClick: false }));

  const subtext = document.createElement("p");
  subtext.className = "intel-connect-subtext";
  subtext.textContent = isLowConfidence
    ? "This is an early signal. The app can confirm live context at the event."
    : "Live connections happen inside the app at the event.";

  const fallback = document.createElement("div");
  fallback.className = "intel-connect-fallback";
  fallback.hidden = true;
  fallback.innerHTML = `
    <p class="intel-connect-fallback-title">Having trouble opening the app?</p>
    <div class="intel-connect-fallback-actions">
      <button type="button" class="intel-fallback-btn" data-intel-fallback="retry">Try again</button>
      <button type="button" class="intel-fallback-btn" data-intel-fallback="copy">Copy profile link</button>
      <button type="button" class="intel-fallback-btn" data-intel-fallback="view">View profile</button>
    </div>
    <p class="intel-connect-fallback-status" aria-live="polite"></p>
  `;

  fallback.querySelector("[data-intel-fallback='retry']")?.addEventListener("click", () =>
    handleSuggestConnect(block, { hasAttemptedDeepLinkForThisClick: false }));
  fallback.querySelector("[data-intel-fallback='copy']")?.addEventListener("click", async () => {
    const status = fallback.querySelector(".intel-connect-fallback-status");
    const ok = await copyProfileLink(shareableUrl);
    if (status) status.textContent = ok ? "Profile link copied." : "Could not copy automatically. Use View profile instead.";
  });
  fallback.querySelector("[data-intel-fallback='view']")?.addEventListener("click", () => {
    if (shareableUrl) window.open(shareableUrl, "_blank", "noopener,noreferrer");
  });

  if (!shareableUrl) {
    fallback.querySelector("[data-intel-fallback='copy']")?.setAttribute("hidden", "hidden");
    fallback.querySelector("[data-intel-fallback='view']")?.setAttribute("hidden", "hidden");
  }

  block.append(title, body, button, subtext, fallback);
  logger.log("[CTA] rendered suggest_connect", { confidence: decision.confidence, action: decision.action });
  return block;
}

export function appendRecommendedAction(container, decision) {
  if (!container) return;
  const cta = renderRecommendedAction(decision);
  if (cta) container.appendChild(cta);
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
  if (!isDebugModeEnabled()) return;
  container.appendChild(renderDecisionDebug(decision));
}

// ---------------------------------------------------------------------------
// Supabase data layer
// ---------------------------------------------------------------------------

async function resolveCurrentProfileId() {
  const user = await getCurrentUser();
  if (!user?.id) return null;
  const { data, error } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}

async function getCurrentIntent() {
  try {
    const user = await getCurrentUser();
    if (user?.id) {
      const { data, error } = await supabase
        .from("profiles").select("intent_primary").eq("user_id", user.id).maybeSingle();
      if (!error && data?.intent_primary) {
        const intent = normalizeIntent(data.intent_primary);
        logger.log("[Intent] current:", intent);
        return intent;
      }
    }
  } catch (_) { /* fall through */ }
  const intent = normalizeIntent(localStorage.getItem("intent_primary"));
  logger.log("[Intent] current:", intent);
  return intent;
}

export async function fetchRawSignals(eventId) {
  const fallback = { action: "do_nothing", score: 0, confidence: 0, components: { P: 0, X: 0, O: 0, N: 0, note: "no_signals" } };
  if (!eventId) return fallback;

  const profileId = await resolveCurrentProfileId();
  if (!profileId) return fallback;

  const [
    { data: attendees,    error: attendeesError },
    { data: interactions, error: interactionsError },
  ] = await Promise.all([
    supabase.from("event_attendees").select("profile_id").eq("event_id", eventId),
    supabase.from("interaction_events")
      .select("from_profile_id, to_profile_id, interaction_type, strength, dwell_seconds, signal_strength, created_at")
      .eq("event_id", eventId)
      .or(`from_profile_id.eq.${profileId},to_profile_id.eq.${profileId}`),
  ]);

  if (attendeesError)    logger.error("[EL] attendees error:", attendeesError);
  if (interactionsError) logger.error("[EL] interactions error:", interactionsError);

  const attendeeRows    = attendees    || [];
  const interactionRows = interactions || [];
  const attendeeIds     = new Set(attendeeRows.map((a) => a.profile_id));

  const attendeeIdList = [...attendeeIds];
  const { data: profiles, error: profilesError } = attendeeIdList.length
    ? await supabase
        .from("profiles")
        .select("id, name, intent_primary, intent_secondary, interests, skills")
        .in("id", attendeeIdList)
    : { data: [], error: null };

  if (profilesError) logger.error("[EL] profiles error:", profilesError);

  const profileRows      = profiles || [];
  const relevantProfiles = profileRows;
  const me    = relevantProfiles.find((p) => p.id === profileId);
  const peers = relevantProfiles.filter((p) => p.id !== profileId);
  const intent = await getCurrentIntent();

  if (!attendeeRows.length && !interactionRows.length) {
    logger.log("[EL] action:", fallback.action);
    return fallback;
  }

  const coPresent  = attendeeIds.has(profileId) ? 1 : 0;
  const rawStrength = interactionRows.reduce((acc, r) => {
    const qrBoost = r.interaction_type === "qr_confirmed" ? 0.5 : 0;
    const dwell   = Math.min(1, (Number(r.dwell_seconds) || 0) / 300);
    const s       = clamp01((Number(r.strength)        || 0) / 100);
    const sig     = clamp01((Number(r.signal_strength) || 0) / 100);
    return acc + 0.5 * dwell + 0.25 * s + 0.25 * sig + qrBoost;
  }, 0);

  const P = clamp01(coPresent);
  const X = clamp01(rawStrength / Math.max(1, interactionRows.length));
  const sharedInterestScore  = computeSharedInterestScore(me, peers);
  const peerIntentAlignments = peers.map((peer) => computeIntentAlignment(intent, peer?.intent_primary));
  const intentAlignment      = peerIntentAlignments.length
    ? peerIntentAlignments.reduce((acc, v) => acc + v, 0) / peerIntentAlignments.length
    : 0;
  const O = clamp01(0.5 * sharedInterestScore + 0.5 * intentAlignment);

  const latestTs = interactionRows.reduce((max, r) => Math.max(max, r.created_at ? new Date(r.created_at).getTime() : 0), 0);
  const ageHours = latestTs ? (Date.now() - latestTs) / 3_600_000 : 72;
  const N = clamp01(1 - ageHours / 72);

  const signals  = { P, X, O, N };
  const epsilon  = 0.001;
  const g0 = P, g1 = X, e = 1 - O;
  const c   = clamp01((Number(!!me) + Number(peers.length > 0) + Number(interactionRows.length > 0)) / 3);
  const r_g = N;
  const r = 1 - X, v = Math.abs(P - X), m = 1 - O;
  const alpha = 0.25, beta = 0.2, delta = 0.2;

  const scored = EL_ACTIONS.map((action) => {
    const a_s  = clamp01(actionSuitability(action, signals));
    const score = (((g0 + g1) / (e + epsilon)) * a_s * c * r_g) - alpha * r - beta * v - delta * m;
    return { action, score };
  }).sort((a, b) => b.score - a.score);

  const best       = scored[0] || { action: "do_nothing", score: 0 };
  const confidence = clamp01(c * (0.3 * P + 0.3 * X + 0.2 * O + 0.2 * N));

  const result = {
    action:     best.action,
    score:      Number(best.score.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    components: {
      ...signals, g0, g1, e, epsilon, c, r_g, alpha, beta, delta, r, v, m, intent,
      intentAlignment:      Number(intentAlignment.toFixed(4)),
      sharedInterestScore:  Number(sharedInterestScore.toFixed(4)),
      scored_actions: scored.map((s) => ({ action: s.action, score: Number(s.score.toFixed(4)) })),
    },
  };

  logger.log("[EL] action:", result.action, "score:", result.score);
  return result;
}

export async function fetchIntelligence(eventId) {
  const user = await getCurrentUser();
  if (!user) return { data: null, fallbackDecision: null };

  const { data, error } = await supabase.rpc("get_my_intelligence", { p_event_id: eventId });

  if (error) {
    logger.error("[Intelligence] load error:", error);
    const fallbackDecision = await fetchRawSignals(eventId);
    return { data: null, fallbackDecision };
  }

  if (!data || data.length === 0) {
    const fallbackDecision = await fetchRawSignals(eventId);
    return { data, fallbackDecision };
  }

  return { data, fallbackDecision: null };
}

export async function fetchEventMeta(eventId) {
  if (!eventId) return null;
  try {
    const { data, error } = await supabase.from("events").select("name, starts_at").eq("id", eventId).maybeSingle();
    if (error || !data) return null;
    return {
      name: data.name,
      date: data.starts_at
        ? new Date(data.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : null,
    };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main render entry point
// ---------------------------------------------------------------------------

export function renderIntelligenceInto(container, data, eventMeta = null, fallbackDecision = null) {
  container.innerHTML = "";

  const hasData           = !!(data && data.length > 0);
  const decision          = fallbackDecision ?? computeNextBestAction(data);
  const presentationState = getPresentationState({ hasData, decision });
  const stateCopy         = getStateCopy(presentationState);

  if (eventMeta) container.appendChild(buildEventHeader(eventMeta, presentationState));

  renderPostEventSummary(container, decision, hasData, presentationState);

  if (!hasData) {
    const pending = document.createElement("p");
    pending.className = "intel-processing-note";
    pending.textContent = stateCopy.processing;
    container.appendChild(pending);

    if (presentationState !== PRESENTATION_STATES.NO_SIGNAL) {
      appendRecommendedAction(container, decision);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "intel-connect-btn";
      btn.textContent = stateCopy.cta;
      btn.addEventListener("click", () => handleSuggestConnect(container, { hasAttemptedDeepLinkForThisClick: false }));
      container.appendChild(btn);
    }

    appendDecisionDebug(container, decision);
    appendPersistenceSignal(container, presentationState);
    container.style.display = "";
    return;
  }

  const buckets = {
    recommended: { title: "Strongest interactions", items: [] },
    follow_up:   { title: "People you met",          items: [] },
    missed:      { title: "You missed",               items: [] },
  };
  data.forEach((d) => { if (buckets[d.type]) buckets[d.type].items.push(d); });

  let hasContent = false;
  for (const [, bucket] of Object.entries(buckets)) {
    if (!bucket.items.length) continue;
    hasContent = true;

    const section = document.createElement("div");
    section.className = "intel-section";

    const title = document.createElement("h3");
    title.className = "intel-section-title";
    title.innerHTML = `${escapeHtml(bucket.title)} <span class="intel-section-count">${bucket.items.length}</span>`;
    section.appendChild(title);

    const cards = document.createElement("div");
    cards.className = "intel-cards";
    bucket.items.forEach((item) => cards.appendChild(renderIntelCard(item)));
    section.appendChild(cards);

    container.appendChild(section);
  }

  if (!hasContent) {
    const pending = document.createElement("p");
    pending.className = "intel-processing-note";
    pending.textContent = stateCopy.processing;
    container.appendChild(pending);
  }

  appendRecommendedAction(container, decision);
  appendDecisionDebug(container, decision);
  appendPersistenceSignal(container, presentationState);
  container.style.display = "";
}
