/**
 * intelligence-algo.js — Pure signal computation
 *
 * No DOM. No Supabase. No side effects.
 * Every function here is deterministic and unit-testable.
 */

import { VALID_INTENTS, INTENT_LABELS, isKnownIntent } from "./constants/intents.js";
export { VALID_INTENTS, INTENT_LABELS, isKnownIntent };

const EPSILON = 0.0001;

export const DECISION_ACTIONS = [
  "suggest_connect",
  "suggest_follow_up",
  "suggest_find",
  "suggest_rejoin",
  "suggest_explore",
  "do_nothing",
];

export const EL_ACTIONS = [...DECISION_ACTIONS];

export const PRESENTATION_STATES = {
  EARLY_SIGNAL: "early_signal",
  POST_EVENT_SUMMARY: "post_event_summary",
  NO_SIGNAL: "no_signal",
};

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function sumBy(items, fn) {
  return items.reduce((acc, item) => acc + fn(item), 0);
}

// ---------------------------------------------------------------------------
// Signal normalisation
// ---------------------------------------------------------------------------

export function normalizeSignals(rows) {
  const total = rows.length || 1;
  const recommended = rows.filter((r) => r.type === "recommended");
  const followUp    = rows.filter((r) => r.type === "follow_up");
  const missed      = rows.filter((r) => r.type === "missed");
  const incoming    = rows.filter((r) => r.direction === "incoming");
  const avgScore    = clamp01(sumBy(rows, (r) => Number(r.score) || 0) / (total * 100));
  const maxScore    = clamp01(Math.max(...rows.map((r) => Number(r.score) || 0), 0) / 100);
  const sharedIntentHits = rows.filter((r) => /shared intent/i.test(r.reason || "")).length;

  const P   = clamp01(maxScore);
  const X   = clamp01((recommended.length * 0.9 + followUp.length * 0.6 + missed.length * 0.3) / total);
  const N   = clamp01((avgScore + maxScore) / 2);
  const O   = clamp01((sharedIntentHits / total) * 0.8 + (recommended.length / total) * 0.2);
  const K   = clamp01((followUp.length / total) * 0.7 + (recommended.length / total) * 0.3);
  const L   = clamp01((missed.length / total) * 0.5 + (sharedIntentHits / total) * 0.5);
  const T   = clamp01(1 - Math.min(1, rows.length / 8));
  const F_r = clamp01(0.2 + (followUp.length / total) * 0.3);
  const Q   = clamp01(1 - (rows.length > 0 ? avgScore : 0));

  return {
    signals: { P, X, N, O, K, L, T, F_r, Q },
    meta: {
      total,
      recommendedRatio: clamp01(recommended.length / total),
      followUpRatio:    clamp01(followUp.length / total),
      missedRatio:      clamp01(missed.length / total),
      incomingRatio:    clamp01(incoming.length / total),
    },
  };
}

export function computeBaseComponents(signals) {
  const g0 = clamp01(0.45 * signals.P + 0.35 * signals.X + 0.2  * signals.N);
  const g1 = clamp01(0.4  * signals.O + 0.35 * signals.K + 0.25 * signals.L);
  const e  = clamp01(0.45 * signals.T + 0.3  * signals.F_r + 0.25 * signals.Q);
  return { g0, g1, e };
}

export function getActionComponentFactors(action, meta, signals) {
  const common = {
    c:   clamp01(1 - signals.Q),
    r_g: clamp01(0.5 + meta.recommendedRatio * 0.5),
  };
  switch (action) {
    case "suggest_connect":
      return { ...common, a_s: clamp01(0.7 + meta.recommendedRatio * 0.3), r: 0.15, v: 0.1,  m: 0.2  };
    case "suggest_follow_up":
      return { ...common, a_s: clamp01(0.45 + meta.followUpRatio * 0.55),  r: 0.2,  v: 0.15, m: 0.2  };
    case "suggest_find":
      return { ...common, a_s: clamp01(0.35 + meta.missedRatio * 0.65),    r: 0.25, v: 0.2,  m: 0.15 };
    case "suggest_rejoin":
      return { ...common, a_s: clamp01(0.3 + meta.incomingRatio * 0.7),    r: 0.35, v: 0.2,  m: 0.1  };
    case "suggest_explore":
      return { ...common, a_s: clamp01(0.25 + signals.O * 0.75),            r: 0.2,  v: 0.25, m: 0.1  };
    case "do_nothing":
    default:
      return { ...common, a_s: 0, r: 0, v: 0, m: 0 };
  }
}

export function computeNextBestAction(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      action: "do_nothing", score: 0, confidence: 0,
      components: { g0: 0, g1: 0, e: 0, a_s: 0, c: 0, r_g: 0, r: 0, v: 0, m: 0 },
      signals:    { P: 0, X: 0, N: 0, O: 0, K: 0, L: 0, T: 1, F_r: 1, Q: 1 },
      policy:     { H: 0, reason: "no_rows" },
    };
  }

  const { signals, meta } = normalizeSignals(rows);
  const { g0, g1, e }     = computeBaseComponents(signals);
  const confidence = clamp01(((g0 + g1) / 2) * (1 - signals.Q * 0.5));
  const risk       = clamp01(0.4 * signals.Q + 0.35 * signals.T + 0.25 * signals.F_r);
  const cooldown   = 0;

  let best = {
    action: "do_nothing", score: 0, confidence,
    components: { g0, g1, e, a_s: 0, c: 0, r_g: 0, r: 0, v: 0, m: 0 },
    signals, policy: { H: 1, reason: "baseline" },
  };

  for (const action of DECISION_ACTIONS) {
    if (action === "do_nothing") continue;
    const factors     = getActionComponentFactors(action, meta, signals);
    const pathExists  = rows.length > 0 ? 1 : 0;
    const H = confidence >= 0.3 && risk <= 0.75 && cooldown === 0 && pathExists === 1 ? 1 : 0;
    const phi =
      H === 0
        ? Number.NEGATIVE_INFINITY
        : (((g0 + g1) / (e + EPSILON)) * factors.a_s * factors.c * factors.r_g)
          - 0.5 * factors.r - 0.35 * factors.v - 0.2 * factors.m;

    if (phi > best.score) {
      best = {
        action, score: Number(phi.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
        components: { g0, g1, e, ...factors },
        signals, policy: { H, reason: H ? "eligible" : "gated" },
      };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Decision signal accessors
// ---------------------------------------------------------------------------

export function getDecisionSignals(decision) {
  if (!decision || typeof decision !== "object") return { P: 0, X: 0 };
  const source = decision.signals ?? decision.components?.signals ?? decision.components ?? {};
  return {
    P: clamp01(Number(source.P) || 0),
    X: clamp01(Number(source.X) || 0),
    O: clamp01(Number(source.O) || 0),
    N: clamp01(Number(source.N) || 0),
  };
}

export function shouldPromoteFallbackDecision(decision) {
  return !!decision && decision.action !== "do_nothing" && Number(decision.confidence) > 0.2;
}

export function hasMeaningfulFallbackDecision(decision) {
  if (!decision || typeof decision !== "object") return false;
  return decision.action !== "do_nothing" && Number(decision.confidence ?? 0) > 0.2;
}

export function buildPostEventSummary(decision, hasData) {
  const { P, X } = getDecisionSignals(decision);
  if (P > 0.5 && X > 0.25) return "Possible signal based on shared presence and recent interaction.";
  if (P > 0.5) return "You crossed paths at the same event, which may be worth exploring.";
  if (X > 0.25) return "Possible signal from recent interaction activity.";
  return hasData
    ? "Your post-event intelligence report is ready with interaction highlights."
    : "Your post-event intelligence report is taking shape from early event signals.";
}

export function buildSignalInsights(decision) {
  const { P, X, N } = getDecisionSignals(decision);
  return [
    {
      label: "Shared presence",
      value: P > 0.5 ? "Confirmed at this event" : "Limited co-presence signal",
    },
    {
      label: "Interaction strength",
      value: X > 0.5 ? "Strong interaction signal" : X > 0.2 ? "Moderate interaction signal" : "Light interaction signal",
    },
    {
      label: "Timing",
      value: N > 0.5 ? "Interaction was recent" : "Interaction was less recent",
    },
  ].slice(0, 3);
}

// ---------------------------------------------------------------------------
// Intent helpers
// ---------------------------------------------------------------------------

export function normalizeIntent(intent) {
  if (!intent) return "";
  const n = String(intent).trim().toLowerCase();
  return n === "demo_something" ? "demo" : n;
}

export function computeIntentAlignment(myIntent, otherIntent) {
  if (myIntent && !isKnownIntent(myIntent)) {
    console.warn(`[EL] Unknown intent value: "${myIntent}"`);
  }
  if (otherIntent && !isKnownIntent(otherIntent)) {
    console.warn(`[EL] Unknown intent value: "${otherIntent}"`);
  }
  const mine  = normalizeIntent(myIntent);
  const other = normalizeIntent(otherIntent);
  if (!mine || !other) return 0;
  if (mine === other) return 1;
  // demo_something is listed explicitly as an alias for demo so that
  // callers passing the raw value without normalization still score correctly.
  const matrix = {
    meet_people:    ["explore_ideas", "demo"],
    find_cofounder: ["demo", "explore_ideas"],
    hire:           ["demo"],
    explore_ideas:  ["meet_people", "find_cofounder"],
    demo:           ["find_cofounder", "hire"],
    demo_something: ["find_cofounder", "hire"],
  };
  return matrix[mine]?.includes(other) ? 0.6 : 0.2;
}

export function computeSharedInterestScore(currentProfile, peerProfiles) {
  const toSet = (obj) => {
    if (!obj || typeof obj !== "object") return new Set();
    const raw = obj.interests ?? obj.tags ?? obj.topics ?? obj.intent_secondary ?? [];
    return new Set(
      (Array.isArray(raw) ? raw : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    );
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

export function actionSuitability(action, s) {
  switch (action) {
    case "suggest_connect":  return 0.5 + 0.4 * s.P + 0.1 * s.O;
    case "suggest_follow_up": return 0.5 + 0.4 * s.X + 0.1 * s.N;
    case "suggest_find":     return 0.4 + 0.4 * s.O + 0.2 * (1 - s.X);
    case "suggest_rejoin":   return 0.4 + 0.4 * (1 - s.N) + 0.2 * s.P;
    case "suggest_explore":  return 0.5 + 0.3 * (1 - s.O) + 0.2 * s.N;
    case "do_nothing":       return 0.3 + 0.7 * (1 - s.P);
    default:                 return 0.5;
  }
}

// ---------------------------------------------------------------------------
// Presentation state machine
// ---------------------------------------------------------------------------

export function getPresentationState({ hasData, decision }) {
  if (hasData) return PRESENTATION_STATES.POST_EVENT_SUMMARY;
  if (hasMeaningfulFallbackDecision(decision)) return PRESENTATION_STATES.EARLY_SIGNAL;
  return PRESENTATION_STATES.NO_SIGNAL;
}

export function getStateCopy(state) {
  if (state === PRESENTATION_STATES.EARLY_SIGNAL) {
    return {
      title:      "Early signal: this could be useful",
      body:       "Nearify has limited confirmed event data so far. Open the app at the event to confirm live recommendations.",
      cta:        "Open Nearify to explore this signal",
      processing: "Open Nearify at the event to confirm this early signal.",
      footer:     "This may appear in People after you connect.",
    };
  }
  if (state === PRESENTATION_STATES.POST_EVENT_SUMMARY) {
    return {
      title:      "Post-event summary",
      body:       "Review people you met and follow up while the context is fresh.",
      cta:        "Open Nearify to connect live",
      processing: "Open Nearify at the event to see live recommendations.",
      footer:     "Saved connections appear in People for follow-up.",
    };
  }
  return {
    title:      "No useful signal yet",
    body:       "Join or check in with Nearify at the event to generate live recommendations.",
    cta:        "Open Nearify at the event",
    processing: "Open Nearify at the event to generate live recommendations.",
    footer:     "Nearify creates better summaries after real event activity.",
  };
}
