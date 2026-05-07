import { describe, it, expect } from "vitest";
import {
  clamp01,
  sumBy,
  normalizeSignals,
  computeBaseComponents,
  getActionComponentFactors,
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
  PRESENTATION_STATES,
  DECISION_ACTIONS,
} from "../assets/js/intelligence-algo.js";

// ---------------------------------------------------------------------------
// clamp01
// ---------------------------------------------------------------------------

describe("clamp01", () => {
  it("returns value unchanged when within [0, 1]", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });

  it("clamps negative values to 0", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(-0.001)).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(clamp01(2)).toBe(1);
    expect(clamp01(1.001)).toBe(1);
  });

  it("returns 0 for non-finite values", () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);  // isFinite guard fires before Math.min
    expect(clamp01(-Infinity)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sumBy
// ---------------------------------------------------------------------------

describe("sumBy", () => {
  it("sums by identity", () => {
    expect(sumBy([1, 2, 3], (x) => x)).toBe(6);
  });

  it("sums by property", () => {
    expect(sumBy([{ v: 2 }, { v: 3 }], (x) => x.v)).toBe(5);
  });

  it("returns 0 for empty array", () => {
    expect(sumBy([], (x) => x)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeIntent
// ---------------------------------------------------------------------------

describe("normalizeIntent", () => {
  it("normalises to lowercase", () => {
    expect(normalizeIntent("Meet_People")).toBe("meet_people");
  });

  it("maps demo_something to demo", () => {
    expect(normalizeIntent("demo_something")).toBe("demo");
    expect(normalizeIntent("DEMO_SOMETHING")).toBe("demo");
  });

  it("trims whitespace", () => {
    expect(normalizeIntent("  hire  ")).toBe("hire");
  });

  it("returns empty string for falsy input", () => {
    expect(normalizeIntent(null)).toBe("");
    expect(normalizeIntent(undefined)).toBe("");
    expect(normalizeIntent("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// computeIntentAlignment
// ---------------------------------------------------------------------------

describe("computeIntentAlignment", () => {
  it("returns 1 for identical intents", () => {
    expect(computeIntentAlignment("hire", "hire")).toBe(1);
    expect(computeIntentAlignment("meet_people", "meet_people")).toBe(1);
  });

  it("returns 0.6 for complementary intents", () => {
    expect(computeIntentAlignment("hire", "demo")).toBe(0.6);
    expect(computeIntentAlignment("meet_people", "explore_ideas")).toBe(0.6);
    expect(computeIntentAlignment("find_cofounder", "demo")).toBe(0.6);
  });

  it("returns 0.2 for non-aligned intents", () => {
    expect(computeIntentAlignment("hire", "meet_people")).toBe(0.2);
    expect(computeIntentAlignment("hire", "explore_ideas")).toBe(0.2);
  });

  it("returns 0 when either intent is missing", () => {
    expect(computeIntentAlignment("", "hire")).toBe(0);
    expect(computeIntentAlignment("hire", "")).toBe(0);
    expect(computeIntentAlignment(null, "hire")).toBe(0);
    expect(computeIntentAlignment("hire", null)).toBe(0);
  });

  it("alignment matrix is consistent: demo aligns with find_cofounder and hire", () => {
    expect(computeIntentAlignment("demo", "find_cofounder")).toBe(0.6);
    expect(computeIntentAlignment("demo", "hire")).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// computeSharedInterestScore
// ---------------------------------------------------------------------------

describe("computeSharedInterestScore", () => {
  const me = { interests: ["ai", "startups", "design"] };

  it("returns 1 when all interests overlap", () => {
    const peers = [{ interests: ["ai", "startups", "design"] }];
    expect(computeSharedInterestScore(me, peers)).toBe(1);
  });

  it("returns 0 when no interests overlap", () => {
    const peers = [{ interests: ["cooking", "travel"] }];
    expect(computeSharedInterestScore(me, peers)).toBe(0);
  });

  it("returns partial score for partial overlap", () => {
    const peers = [{ interests: ["ai", "cooking"] }];
    const score = computeSharedInterestScore(me, peers);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when current profile has no interests", () => {
    expect(computeSharedInterestScore({}, [{ interests: ["ai"] }])).toBe(0);
    expect(computeSharedInterestScore(null, [{ interests: ["ai"] }])).toBe(0);
  });

  it("returns 0 when peer list is empty", () => {
    expect(computeSharedInterestScore(me, [])).toBe(0);
  });

  it("averages scores across multiple peers", () => {
    const fullOverlap = { interests: ["ai", "startups", "design"] };
    const noOverlap   = { interests: ["cooking"] };
    const score = computeSharedInterestScore(me, [fullOverlap, noOverlap]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("reads interests from tags or topics fallback fields", () => {
    const withTags   = { tags: ["ai", "startups"] };
    const withTopics = { topics: ["ai"] };
    expect(computeSharedInterestScore(withTags, [withTopics])).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    const profile = { interests: ["AI", "Startups"] };
    const peer    = { interests: ["ai", "startups"] };
    expect(computeSharedInterestScore(profile, [peer])).toBe(1);
  });

  it("output is always in [0, 1]", () => {
    const score = computeSharedInterestScore(me, [me, me, me]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeSignals
// ---------------------------------------------------------------------------

describe("normalizeSignals", () => {
  it("returns all-zero-ish signals for empty rows", () => {
    const { signals } = normalizeSignals([]);
    expect(signals.P).toBe(0);
    expect(signals.X).toBe(0);
  });

  it("returns signals clamped to [0, 1]", () => {
    const rows = [
      { type: "recommended", direction: "incoming", score: 150, reason: "shared intent match" },
      { type: "follow_up",   direction: "outgoing", score: 80,  reason: "" },
    ];
    const { signals, meta } = normalizeSignals(rows);
    for (const val of Object.values(signals)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
    expect(meta.total).toBe(2);
    expect(meta.recommendedRatio).toBeCloseTo(0.5);
  });

  it("boosts O signal when shared intent reasons are present", () => {
    const withIntent    = [{ type: "recommended", direction: "incoming", score: 80, reason: "shared intent" }];
    const withoutIntent = [{ type: "recommended", direction: "incoming", score: 80, reason: "brief interaction" }];
    const { signals: s1 } = normalizeSignals(withIntent);
    const { signals: s2 } = normalizeSignals(withoutIntent);
    expect(s1.O).toBeGreaterThan(s2.O);
  });

  it("increases X with more recommended rows", () => {
    const oneRec  = [{ type: "recommended", direction: "outgoing", score: 80, reason: "" }];
    const twoRecs = [
      { type: "recommended", direction: "outgoing", score: 80, reason: "" },
      { type: "recommended", direction: "outgoing", score: 80, reason: "" },
    ];
    const { signals: s1 } = normalizeSignals(oneRec);
    const { signals: s2 } = normalizeSignals(twoRecs);
    expect(s2.X).toBeGreaterThanOrEqual(s1.X);
  });
});

// ---------------------------------------------------------------------------
// computeBaseComponents
// ---------------------------------------------------------------------------

describe("computeBaseComponents", () => {
  it("returns values in [0, 1]", () => {
    const signals = { P: 0.8, X: 0.6, N: 0.9, O: 0.5, K: 0.4, L: 0.3, T: 0.2, F_r: 0.3, Q: 0.1 };
    const { g0, g1, e } = computeBaseComponents(signals);
    expect(g0).toBeGreaterThanOrEqual(0); expect(g0).toBeLessThanOrEqual(1);
    expect(g1).toBeGreaterThanOrEqual(0); expect(g1).toBeLessThanOrEqual(1);
    expect(e).toBeGreaterThanOrEqual(0);  expect(e).toBeLessThanOrEqual(1);
  });

  it("g0 increases with higher P, X, N", () => {
    const low  = computeBaseComponents({ P: 0.1, X: 0.1, N: 0.1, O: 0, K: 0, L: 0, T: 0, F_r: 0, Q: 0 });
    const high = computeBaseComponents({ P: 0.9, X: 0.9, N: 0.9, O: 0, K: 0, L: 0, T: 0, F_r: 0, Q: 0 });
    expect(high.g0).toBeGreaterThan(low.g0);
  });
});

// ---------------------------------------------------------------------------
// actionSuitability
// ---------------------------------------------------------------------------

describe("actionSuitability", () => {
  const highPresence = { P: 1, X: 0.5, O: 0.8, N: 0.9 };
  const lowPresence  = { P: 0, X: 0.1, O: 0.1, N: 0.1 };

  it("suggest_connect scores higher with high presence", () => {
    expect(actionSuitability("suggest_connect", highPresence))
      .toBeGreaterThan(actionSuitability("suggest_connect", lowPresence));
  });

  it("do_nothing scores higher with low presence", () => {
    expect(actionSuitability("do_nothing", lowPresence))
      .toBeGreaterThan(actionSuitability("do_nothing", highPresence));
  });

  it("returns 0.5 for unknown actions", () => {
    expect(actionSuitability("unknown_action", highPresence)).toBe(0.5);
  });

  it("all known actions return values in [0, 1]", () => {
    for (const action of DECISION_ACTIONS) {
      const v = actionSuitability(action, highPresence);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// computeNextBestAction
// ---------------------------------------------------------------------------

describe("computeNextBestAction", () => {
  it("returns do_nothing for null input", () => {
    expect(computeNextBestAction(null).action).toBe("do_nothing");
  });

  it("returns do_nothing for empty array", () => {
    expect(computeNextBestAction([]).action).toBe("do_nothing");
  });

  it("always returns a valid action", () => {
    const rows = [
      { type: "recommended", direction: "incoming", score: 90, reason: "shared intent" },
      { type: "follow_up",   direction: "outgoing", score: 60, reason: "" },
    ];
    const result = computeNextBestAction(rows);
    expect(DECISION_ACTIONS).toContain(result.action);
  });

  it("confidence is in [0, 1]", () => {
    const rows = [{ type: "recommended", direction: "incoming", score: 80, reason: "" }];
    const { confidence } = computeNextBestAction(rows);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("score is a finite number", () => {
    const rows = [{ type: "recommended", direction: "outgoing", score: 70, reason: "" }];
    const { score } = computeNextBestAction(rows);
    expect(Number.isFinite(score)).toBe(true);
  });

  it("strong recommended signal favours suggest_connect or suggest_follow_up", () => {
    const rows = Array.from({ length: 5 }, () => ({
      type: "recommended", direction: "incoming", score: 95, reason: "shared intent",
    }));
    const { action } = computeNextBestAction(rows);
    expect(["suggest_connect", "suggest_follow_up"]).toContain(action);
  });

  it("result includes signals and components", () => {
    const rows = [{ type: "follow_up", direction: "outgoing", score: 55, reason: "" }];
    const result = computeNextBestAction(rows);
    expect(result.signals).toBeDefined();
    expect(result.components).toBeDefined();
    expect(result.policy).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getDecisionSignals
// ---------------------------------------------------------------------------

describe("getDecisionSignals", () => {
  it("extracts P, X, O, N from decision.signals", () => {
    const decision = { signals: { P: 0.8, X: 0.6, O: 0.4, N: 0.9 } };
    const s = getDecisionSignals(decision);
    expect(s.P).toBeCloseTo(0.8);
    expect(s.X).toBeCloseTo(0.6);
    expect(s.O).toBeCloseTo(0.4);
    expect(s.N).toBeCloseTo(0.9);
  });

  it("falls back to decision.components", () => {
    const decision = { components: { P: 0.5, X: 0.3, O: 0.2, N: 0.7 } };
    const s = getDecisionSignals(decision);
    expect(s.P).toBeCloseTo(0.5);
  });

  it("clamps values to [0, 1]", () => {
    const decision = { signals: { P: 2, X: -1, O: 0.5, N: 0.5 } };
    const s = getDecisionSignals(decision);
    expect(s.P).toBe(1);
    expect(s.X).toBe(0);
  });

  it("returns zeros for null or missing input", () => {
    const s = getDecisionSignals(null);
    expect(s.P).toBe(0);
    expect(s.X).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shouldPromoteFallbackDecision / hasMeaningfulFallbackDecision
// ---------------------------------------------------------------------------

describe("shouldPromoteFallbackDecision", () => {
  it("returns true for non-do_nothing with confidence > 0.2", () => {
    expect(shouldPromoteFallbackDecision({ action: "suggest_connect", confidence: 0.5 })).toBe(true);
  });

  it("returns false for do_nothing", () => {
    expect(shouldPromoteFallbackDecision({ action: "do_nothing", confidence: 0.9 })).toBe(false);
  });

  it("returns false when confidence is <= 0.2", () => {
    expect(shouldPromoteFallbackDecision({ action: "suggest_connect", confidence: 0.2 })).toBe(false);
    expect(shouldPromoteFallbackDecision({ action: "suggest_connect", confidence: 0.1 })).toBe(false);
  });

  it("returns false for null", () => {
    expect(shouldPromoteFallbackDecision(null)).toBe(false);
  });
});

describe("hasMeaningfulFallbackDecision", () => {
  it("returns true for actionable decision above threshold", () => {
    expect(hasMeaningfulFallbackDecision({ action: "suggest_find", confidence: 0.4 })).toBe(true);
  });

  it("returns false for do_nothing regardless of confidence", () => {
    expect(hasMeaningfulFallbackDecision({ action: "do_nothing", confidence: 1 })).toBe(false);
  });

  it("returns false for null or non-object", () => {
    expect(hasMeaningfulFallbackDecision(null)).toBe(false);
    expect(hasMeaningfulFallbackDecision("string")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildPostEventSummary
// ---------------------------------------------------------------------------

describe("buildPostEventSummary", () => {
  it("returns strong-signal copy when P and X are high", () => {
    const decision = { signals: { P: 0.8, X: 0.5, O: 0.5, N: 0.5 } };
    const text = buildPostEventSummary(decision, true);
    expect(text).toMatch(/shared presence|interaction/i);
  });

  it("returns presence-only copy when only P is high", () => {
    const decision = { signals: { P: 0.8, X: 0.1, O: 0, N: 0 } };
    const text = buildPostEventSummary(decision, false);
    expect(text).toMatch(/crossed paths/i);
  });

  it("returns interaction-only copy when only X is high", () => {
    const decision = { signals: { P: 0.1, X: 0.5, O: 0, N: 0 } };
    const text = buildPostEventSummary(decision, false);
    expect(text).toMatch(/interaction/i);
  });

  it("returns generic copy when signals are low", () => {
    const decision = { signals: { P: 0, X: 0, O: 0, N: 0 } };
    const text = buildPostEventSummary(decision, false);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildSignalInsights
// ---------------------------------------------------------------------------

describe("buildSignalInsights", () => {
  it("returns exactly 3 insights", () => {
    const decision = { signals: { P: 0.8, X: 0.6, N: 0.7, O: 0.5 } };
    expect(buildSignalInsights(decision)).toHaveLength(3);
  });

  it("each insight has label and value strings", () => {
    const decision = { signals: { P: 0.8, X: 0.6, N: 0.7, O: 0.5 } };
    for (const insight of buildSignalInsights(decision)) {
      expect(typeof insight.label).toBe("string");
      expect(typeof insight.value).toBe("string");
    }
  });

  it("reflects strong presence in the shared presence insight", () => {
    const strong = { signals: { P: 0.9, X: 0.1, N: 0.5 } };
    const weak   = { signals: { P: 0.1, X: 0.1, N: 0.5 } };
    const [strongInsight] = buildSignalInsights(strong);
    const [weakInsight]   = buildSignalInsights(weak);
    expect(strongInsight.value).toMatch(/confirmed/i);
    expect(weakInsight.value).toMatch(/limited/i);
  });
});

// ---------------------------------------------------------------------------
// getPresentationState
// ---------------------------------------------------------------------------

describe("getPresentationState", () => {
  it("returns POST_EVENT_SUMMARY when data exists", () => {
    const state = getPresentationState({ hasData: true, decision: { action: "do_nothing", confidence: 0 } });
    expect(state).toBe(PRESENTATION_STATES.POST_EVENT_SUMMARY);
  });

  it("returns EARLY_SIGNAL when no data but decision is meaningful", () => {
    const state = getPresentationState({
      hasData: false,
      decision: { action: "suggest_connect", confidence: 0.5 },
    });
    expect(state).toBe(PRESENTATION_STATES.EARLY_SIGNAL);
  });

  it("returns NO_SIGNAL when no data and decision is do_nothing", () => {
    const state = getPresentationState({
      hasData: false,
      decision: { action: "do_nothing", confidence: 0 },
    });
    expect(state).toBe(PRESENTATION_STATES.NO_SIGNAL);
  });
});

// ---------------------------------------------------------------------------
// getStateCopy
// ---------------------------------------------------------------------------

describe("getStateCopy", () => {
  it("returns copy object with required keys for each state", () => {
    const requiredKeys = ["title", "body", "cta", "processing", "footer"];
    for (const state of Object.values(PRESENTATION_STATES)) {
      const copy = getStateCopy(state);
      for (const key of requiredKeys) {
        expect(copy).toHaveProperty(key);
        expect(typeof copy[key]).toBe("string");
        expect(copy[key].length).toBeGreaterThan(0);
      }
    }
  });

  it("returns distinct copy for each state", () => {
    const early = getStateCopy(PRESENTATION_STATES.EARLY_SIGNAL);
    const post  = getStateCopy(PRESENTATION_STATES.POST_EVENT_SUMMARY);
    const none  = getStateCopy(PRESENTATION_STATES.NO_SIGNAL);
    expect(early.title).not.toBe(post.title);
    expect(post.title).not.toBe(none.title);
  });

  it("returns NO_SIGNAL copy for unknown state", () => {
    const fallback = getStateCopy("unknown_state");
    const noSignal = getStateCopy(PRESENTATION_STATES.NO_SIGNAL);
    expect(fallback.title).toBe(noSignal.title);
  });
});
