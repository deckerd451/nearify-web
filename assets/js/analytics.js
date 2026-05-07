import { logger } from "./logger.js";
/**
 * analytics.js — Stub for event tracking.
 * Provides exports expected by join.js and other pages.
 */

export function trackAppCtaClick(action, metadata = {}) {
  logger.log("[Analytics]", action, metadata);
}

export function trackPageView(metadata = {}) {
  logger.log("[Analytics] pageView", metadata);
}

export function wireAppCtaTracking() {
  // No-op stub — real implementation pending
  logger.log("[Analytics] wireAppCtaTracking skipped");
}
