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
  incoming: "They connected with you",
  outgoing: "You connected with them",
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
  if (!r) return "";
  if (!/[.!?]$/.test(r)) r += ".";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

// ---------------------------------------------------------------------------
// Signal enrichment helpers (Relationship Visibility Sprint)
// ---------------------------------------------------------------------------

const INTENT_DISPLAY_LABELS = {
  meet_people:    "Meeting people",
  find_cofounder: "Finding collaborators",
  hire:           "Hiring",
  explore_ideas:  "Exploring ideas",
  demo:           "Demoing",
};

function renderQrBadge() {
  const el = document.createElement("span");
  el.className = "intel-qr-badge";
  el.textContent = "QR Confirmed";
  return el;
}

function renderIntentPill(myIntent, theirIntent) {
  const myNorm    = normalizeIntent(myIntent);
  const theirNorm = normalizeIntent(theirIntent);
  if (!myNorm || !theirNorm) return null;
  if (computeIntentAlignment(myNorm, theirNorm) < 0.6) return null;
  const myLabel    = INTENT_DISPLAY_LABELS[myNorm];
  const theirLabel = INTENT_DISPLAY_LABELS[theirNorm];
  if (!myLabel || !theirLabel) return null;
  const text = myNorm === theirNorm ? `Both: ${myLabel}` : `${myLabel} ↔ ${theirLabel}`;
  const el = document.createElement("span");
  el.className = "intel-intent-pill";
  el.textContent = text;
  return el;
}

function renderDwellHint(dwellSeconds) {
  if (!dwellSeconds || dwellSeconds < 30) return null;
  const mins = Math.round(dwellSeconds / 60);
  const text = mins < 1 ? "Less than a minute together" : `~${mins} min together`;
  const el = document.createElement("p");
  el.className = "intel-dwell-hint";
  el.textContent = text;
  return el;
}

function renderEncounterLine(encounterCount, firstEventName) {
  if (!encounterCount || encounterCount <= 0) return null;
  let text = encounterCount === 1
    ? (firstEventName ? `Met at ${firstEventName}` : "Met at a previous event")
    : `${encounterCount} events together`;
  if (encounterCount > 1 && firstEventName) text += ` · First: ${firstEventName}`;
  const el = document.createElement("p");
  el.className = "intel-encounter-line";
  el.textContent = text;
  return el;
}

function stripSignalPhrases(reason, { hasQr, hasIntentPill, hasEncounterLine }) {
  if (!reason) return "";
  let r = reason;
  if (hasQr) {
    r = r.replace(/Confirmed connection\.\s*/gi, "");
    r = r.replace(/You have a confirmed relationship[^.]*\.\s*/gi, "");
  }
  if (hasIntentPill) r = r.replace(/Shared intent:[^.]*\.\s*/gi, "");
  if (hasEncounterLine) r = r.replace(/You['']ve both attended \d+ previous events?\.\s*/gi, "");
  return r.trim();
}

function isDebugModeEnabled() {
  return localStorage.getItem("nearify_intel_debug") === "1";
}

// ---------------------------------------------------------------------------
// Relationship confirmation
// ---------------------------------------------------------------------------

// Card types eligible for the "Keep in touch" CTA. re_engaged is excluded —
// confirmed pairs have their own static label and no button.
const CONFIRM_ELIGIBLE_TYPES = new Set(["recommended", "follow_up", "missed"]);

// Builds the relationship footer for a card.
// Returns a DOM node (button or static label) or null when nothing should show.
// context = { eventId: string|null, isAuthenticated: boolean }
//
// Note: get_my_intelligence does not return the intelligence row id, so
// p_source_intel_id is always null here. The RPC treats it as optional provenance.
function renderRelationshipFooter(item, { eventId, isAuthenticated }) {
  if (!isAuthenticated || !item.target_profile_id || !eventId) return null;

  const status = item.relationship_status;
  const type   = item.type;

  // re_engaged rows always surface a static label — confirmed pair co-attending again.
  if (type === "re_engaged" || status === "re_engaged") {
    const el = document.createElement("p");
    el.className = "intel-rel-status";
    el.textContent = "You're connected — here again together";
    return el;
  }

  if (status === "confirmed") {
    const el = document.createElement("p");
    el.className = "intel-rel-status";
    el.textContent = "Relationship remembered";
    return el;
  }

  if (status === "proposed_by_me") {
    const el = document.createElement("p");
    el.className = "intel-rel-status";
    el.textContent = "Saved — waiting for them";
    return el;
  }

  // Only show buttons for eligible types. Rows that are none of the above
  // states but have an ineligible type (shouldn't happen in practice) are skipped.
  if (!CONFIRM_ELIGIBLE_TYPES.has(type)) return null;

  const footer = document.createElement("div");
  footer.className = "intel-card-rel-footer";

  const originalText = status === "proposed_by_them" ? "Keep in touch too" : "Keep in touch";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "intel-rel-btn";
  btn.textContent = originalText;

  const snoozeBtn = document.createElement("button");
  snoozeBtn.type = "button";
  snoozeBtn.className = "intel-rel-snooze-btn";
  snoozeBtn.textContent = "Not now";

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    snoozeBtn.disabled = true;
    btn.textContent = "Saving…";
    logger.log("[RelationshipConfirmation]", `click target=${item.target_profile_id}`);

    const { data: result, error } = await supabase.rpc("confirm_relationship", {
      p_other_profile_id: item.target_profile_id,
      p_source_event_id:  eventId,
      p_source_intel_id:  null,
    });

    if (error) {
      logger.log("[RelationshipConfirmation]", `error ${error.message}`);
      btn.disabled = false;
      snoozeBtn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    const newStatus = result?.status === "confirmed" ? "confirmed" : "proposed_by_me";
    logger.log("[RelationshipConfirmation]", `success status=${newStatus}`);

    const statusEl = document.createElement("p");
    statusEl.className = "intel-rel-status";
    statusEl.textContent = newStatus === "confirmed" ? "Relationship remembered" : "Saved — waiting for them";
    footer.replaceWith(statusEl);
  });

  snoozeBtn.addEventListener("click", async () => {
    if (snoozeBtn.disabled) return;
    btn.disabled = true;
    snoozeBtn.disabled = true;
    snoozeBtn.textContent = "Dismissing…";
    logger.log("[RelationshipSnooze]", `click target=${item.target_profile_id}`);

    const { error } = await supabase.rpc("snooze_relationship", {
      p_other_profile_id: item.target_profile_id,
      p_source_event_id:  eventId,
    });

    if (error) {
      logger.log("[RelationshipSnooze]", `error ${error.message}`);
      btn.disabled = false;
      snoozeBtn.disabled = false;
      snoozeBtn.textContent = "Not now";
      return;
    }

    logger.log("[RelationshipSnooze]", "snoozed");
    const statusEl = document.createElement("p");
    statusEl.className = "intel-rel-status";
    statusEl.textContent = "Dismissed";
    footer.replaceWith(statusEl);
  });

  footer.append(btn, snoozeBtn);
  return footer;
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

// context = { eventId, isAuthenticated } — optional; omitting disables relationship footer.
export function renderIntelCard(item, context = {}) {
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

  // Meta row: direction label + optional QR badge
  const hasQr = !!(item.reason?.includes("Confirmed connection") || item.reason?.includes("confirmed relationship"));
  const meta = document.createElement("div");
  meta.className = "intel-card-meta";
  const dirLabel = document.createElement("span");
  dirLabel.className = `intel-direction ${item.direction === "incoming" ? "incoming" : "outgoing"}`;
  dirLabel.textContent = DIRECTION_LABELS[item.direction] ?? "Interaction";
  meta.appendChild(dirLabel);
  if (hasQr) meta.appendChild(renderQrBadge());
  body.appendChild(meta);

  // Intent alignment pill
  const intentPill = renderIntentPill(item.my_intent, item.their_intent);
  if (intentPill) body.appendChild(intentPill);

  // Reason text — strip phrases that have a dedicated visual
  const hasEncounterLine = item.encounter_count > 0;
  const cleanedReason = stripSignalPhrases(item.reason, { hasQr, hasIntentPill: !!intentPill, hasEncounterLine });
  const reasonEl = document.createElement("div");
  reasonEl.className = "intel-card-reason";
  reasonEl.textContent = normalizeReason(cleanedReason);
  body.appendChild(reasonEl);

  // Dwell hint
  const dwellHint = renderDwellHint(item.dwell_seconds);
  if (dwellHint) body.appendChild(dwellHint);

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
    hint.textContent = "You were at the same event but didn't connect — worth a reach-out.";
    body.appendChild(hint);
  }

  // Encounter history (shown for cards with a relationship history)
  const encounterLine = renderEncounterLine(item.encounter_count, item.first_encounter_event_name);
  if (encounterLine) body.appendChild(encounterLine);

  const relFooter = renderRelationshipFooter(item, context);
  if (relFooter) body.appendChild(relFooter);

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
  const intent             = normalizeIntent(decision?.components?.intent);

  const intentReasons = {
    meet_people:    isLowConfidence ? "You may both be looking to meet people at this event." : "You're both here to meet people.",
    find_cofounder: isLowConfidence ? "You may both be exploring collaboration opportunities." : "You're both exploring collaboration opportunities.",
    hire:           isLowConfidence ? "There may be a hiring match worth exploring." : "There may be a strong hiring match here.",
    explore_ideas:  isLowConfidence ? "You may both be here to explore ideas." : "You're both here to explore ideas.",
    demo:           isLowConfidence ? "One of you may be showcasing something worth seeing." : "One of you is showcasing something worth seeing.",
  };
  const reason = intent
    ? (intentReasons[intent] || (isLowConfidence ? "You may have overlapping goals at this event." : "You connected through a relevant interaction."))
    : (isLowConfidence ? "You may have shared goals at this event." : "You had a notable interaction at this event.");

  const block = document.createElement("div");
  block.className = "intel-recommended-action";

  const title = document.createElement("h3");
  title.className = "intel-recommended-title";
  title.textContent = "Recommended connection";

  const body = document.createElement("p");
  body.className = "intel-recommended-body";
  body.textContent = reason;

  // Sprint enrichments: build elements to insert between body and button
  const enrichments = [];
  if (decision.components?.hasQrConfirmed) {
    enrichments.push(renderQrBadge());
  }
  // Show intent pill only when peer alignment is meaningful (>= 0.6 average across peers)
  if (intent && Number(decision.components?.intentAlignment ?? 0) >= 0.6) {
    const label = INTENT_DISPLAY_LABELS[intent];
    if (label) {
      const pill = document.createElement("span");
      pill.className = "intel-intent-pill";
      pill.textContent = `Both: ${label}`;
      enrichments.push(pill);
    }
  }
  const dwellHint = renderDwellHint(decision.components?.totalDwellSeconds);
  if (dwellHint) enrichments.push(dwellHint);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "intel-connect-btn";
  button.textContent = useStrongLanguage ? "Open Nearify to connect" : "Open Nearify to follow up";
  button.addEventListener("click", () => handleSuggestConnect(block, { hasAttemptedDeepLinkForThisClick: false }));

  const subtext = document.createElement("p");
  subtext.className = "intel-connect-subtext";
  subtext.textContent = isLowConfidence
    ? "This is an early match. Use the Nearify app to connect at the event."
    : "Use the Nearify app to connect in person at the event.";

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

  block.append(title, body, ...enrichments, button, subtext, fallback);
  logger.log("[CTA] rendered suggest_connect", { confidence: decision.confidence, action: decision.action });
  return block;
}

export function appendRecommendedAction(container, decision) {
  if (!container) return;
  console.log("[EL DEBUG] fallback decision", {
    action: decision?.action,
    score: decision?.score,
    reason: decision?.reason,
    components: decision?.components,
    intent: decision?.components?.intent,
    intentAlignment: decision?.components?.intentAlignment,
    totalDwellSeconds: decision?.components?.totalDwellSeconds,
    hasQrConfirmed: decision?.components?.hasQrConfirmed
  });
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

async function getCurrentIntent(eventId) {
  if (!eventId) return "";
  try {
    const profileId = await resolveCurrentProfileId();
    if (!profileId) return "";
    const { data } = await supabase
      .from("event_attendees")
      .select("intent_primary")
      .eq("event_id", eventId)
      .eq("profile_id", profileId)
      .maybeSingle();
    return normalizeIntent(data?.intent_primary);
  } catch (_) { return ""; }
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
  const [
    { data: profiles, error: profilesError },
    { data: attendeeIntents, error: attendeeIntentsError },
  ] = await Promise.all([
    attendeeIdList.length
      ? supabase.from("profiles").select("id, name, interests, skills").in("id", attendeeIdList)
      : Promise.resolve({ data: [], error: null }),
    attendeeIdList.length
      ? supabase.from("event_attendees").select("profile_id, intent_primary, intent_secondary").eq("event_id", eventId).in("profile_id", attendeeIdList)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesError)       logger.error("[EL] profiles error:", profilesError);
  if (attendeeIntentsError) logger.error("[EL] attendee intents error:", attendeeIntentsError);

  // Merge intent fields from event_attendees onto profile objects
  const intentByProfileId = new Map((attendeeIntents || []).map((a) => [a.profile_id, a]));
  const profileRows = (profiles || []).map((p) => {
    const ea = intentByProfileId.get(p.id);
    return ea ? { ...p, intent_primary: ea.intent_primary, intent_secondary: ea.intent_secondary } : p;
  });
  const relevantProfiles = profileRows;
  const me    = relevantProfiles.find((p) => p.id === profileId);
  const peers = relevantProfiles.filter((p) => p.id !== profileId);
  const intent = await getCurrentIntent(eventId);

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

  const totalDwellSeconds = interactionRows.reduce((sum, row) => sum + (Number(row.dwell_seconds) || 0), 0);
  const hasQrConfirmed    = interactionRows.some((row) => row.interaction_type === "qr_confirmed");

  const result = {
    action:     best.action,
    score:      Number(best.score.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    components: {
      ...signals, g0, g1, e, epsilon, c, r_g, alpha, beta, delta, r, v, m, intent,
      intentAlignment:      Number(intentAlignment.toFixed(4)),
      sharedInterestScore:  Number(sharedInterestScore.toFixed(4)),
      totalDwellSeconds,
      hasQrConfirmed,
      scored_actions: scored.map((s) => ({ action: s.action, score: Number(s.score.toFixed(4)) })),
    },
  };

  logger.log("[EL] action:", result.action, "score:", result.score);
  return result;
}

export async function fetchIntelligence(eventId) {
  const user = await getCurrentUser();
  if (!user) return { data: null, fallbackDecision: null, isAuthenticated: false };

  const { data, error } = await supabase.rpc("get_my_intelligence", { p_event_id: eventId });

  if (error) {
    logger.error("[Intelligence] load error:", error);
    const fallbackDecision = await fetchRawSignals(eventId);
    return { data: null, fallbackDecision, isAuthenticated: true };
  }

  if (!data || data.length === 0) {
    const fallbackDecision = await fetchRawSignals(eventId);
    return { data, fallbackDecision, isAuthenticated: true };
  }

  return { data, fallbackDecision: null, isAuthenticated: true };
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

// options = { eventId: string|null, isAuthenticated: boolean }
// Passing options enables relationship CTAs on cards. Omitting is safe (no CTA rendered).
export function renderIntelligenceInto(container, data, eventMeta = null, fallbackDecision = null, options = {}) {
  const cardContext = { eventId: options.eventId ?? null, isAuthenticated: !!options.isAuthenticated };
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
      // DEBUG: log fallback decision values before EARLY_SIGNAL render
      logger.log("[EarlySignalDebug] decision.action =", decision?.action);
      logger.log("[EarlySignalDebug] decision.score =", decision?.score);
      logger.log("[EarlySignalDebug] components.intent =", decision?.components?.intent);
      logger.log("[EarlySignalDebug] components.intentAlignment =", decision?.components?.intentAlignment);
      logger.log("[EarlySignalDebug] components.totalDwellSeconds =", decision?.components?.totalDwellSeconds);
      logger.log("[EarlySignalDebug] components.hasQrConfirmed =", decision?.components?.hasQrConfirmed);
      logger.log("[EarlySignalDebug] full components =", JSON.stringify(decision?.components, null, 2));
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
    re_engaged:  { title: "You Connected Again", items: [] },
    recommended: { title: "Strongest interactions", items: [] },
    follow_up:   { title: "People you met",         items: [] },
    missed:      { title: "Didn't connect",          items: [] },
  };
  data.forEach((d) => {
    if (buckets[d.type]) {
      buckets[d.type].items.push(d);
      logger.log("[RelationshipVisibility]", `type=${d.type}`, d.target_name, `relationship_status=${d.relationship_status ?? "null"}`);
    }
  });

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
    bucket.items.forEach((item) => cards.appendChild(renderIntelCard(item, cardContext)));
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
