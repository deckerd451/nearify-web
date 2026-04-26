import { supabase } from "./supabaseClient.js";

function currentPage() {
  return window.location.pathname + window.location.search;
}

function safeReferrer() {
  try { return document.referrer || null; } catch { return null; }
}

export async function trackEvent(eventName, properties = {}) {
  try {
    await supabase.from("analytics_events").insert({
      event_name: eventName,
      page: currentPage(),
      referrer: safeReferrer(),
      event_id: properties.eventId ?? null,
      profile_id: properties.profileId ?? null,
      properties,
    });
  } catch {
    // Never block user flow for analytics failures
  }
}

export function trackPageView(properties = {}) {
  return trackEvent("page_view", properties);
}

export function trackAppCtaClick(source, properties = {}) {
  return trackEvent("app_cta_click", { source, ...properties });
}

export function wireAppCtaTracking(selector = "[data-track-cta]") {
  document.querySelectorAll(selector).forEach((el) => {
    el.addEventListener("click", () => {
      const source = el.dataset.trackCta || el.id || "unknown";
      const eventId = el.dataset.eventId ?? null;
      trackAppCtaClick(source, eventId ? { eventId } : {});
    });
  });
}
