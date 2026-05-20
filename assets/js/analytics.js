import { supabase } from "./supabaseClient.js";
import { logger } from "./logger.js";

/**
 * analytics.js — Lightweight funnel event tracking.
 *
 * trackFunnelEvent is fire-and-forget: it never throws, never blocks,
 * and never affects the user flow on failure.
 */

// Known event names for the Meetup handoff funnel:
//   meetup_handoff_view         — join page loaded with source=meetup
//   enter_live_network_clicked  — primary or bottom CTA clicked (Meetup flow)
//   testflight_clicked          — any TestFlight install link clicked
//   guest_session_created       — ghost session created successfully
//   app_deep_link_clicked       — auth-handoff "Open in App" tapped

export function trackFunnelEvent(eventName, props = {}) {
  const {
    eventId       = null,
    source        = null,
    sourceEventId = null,
    page          = null,
    referrer      = null,
    ...extra
  } = props;

  const properties = {};
  if (source)        properties.source           = source;
  if (sourceEventId) properties.source_event_id  = sourceEventId;
  // Spread any additional non-sensitive metadata (e.g. button label)
  Object.assign(properties, extra);

  const payload = {
    event_name: eventName,
    page:       page     ?? window.location.pathname,
    referrer:   referrer ?? (document.referrer || null),
    event_id:   eventId  || null,
    properties,
  };

  logger.log("[Analytics:funnel]", eventName, payload);

  supabase
    .from("analytics_events")
    .insert(payload)
    .then(({ error }) => {
      if (error) logger.warn("[Analytics:funnel] insert failed:", error.message);
    });
}

// ── Existing stubs — preserved for callers on other pages ──────────────────

export function trackAppCtaClick(action, metadata = {}) {
  logger.log("[Analytics]", action, metadata);
}

export function trackPageView(metadata = {}) {
  logger.log("[Analytics] pageView", metadata);
}

export function wireAppCtaTracking() {
  logger.log("[Analytics] wireAppCtaTracking skipped");
}
