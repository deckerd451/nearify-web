/**
 * analytics.js — Stub for event tracking.
 * Provides exports expected by join.js and other pages.
 */

export function trackAppCtaClick(action, metadata = {}) {
  console.log("[Analytics]", action, metadata);
}

export function trackPageView(metadata = {}) {
  console.log("[Analytics] pageView", metadata);
}

export function wireAppCtaTracking() {
  // No-op stub — real implementation pending
  console.log("[Analytics] wireAppCtaTracking skipped");
}
