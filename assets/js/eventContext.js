/**
 * Event Context API — consumed by iOS app via WKWebView
 *
 * Usage:
 *   Load /event-context/?event=<uuid> in a WKWebView.
 *   Poll or observe #eventContextPayload until status !== "loading".
 *
 * The DOM element always contains a JSON object with this shape:
 *   { "status": "loading" | "ok" | "error", "version": 1, "data": object|null, "error_code": string|null }
 *
 * error_code values:
 *   "not_authenticated"  — no active Supabase session
 *   "not_attending"      — user is authenticated but not joined to this event
 *   "missing_event_id"   — no ?event= param in URL
 *   "unknown"            — unexpected server or network error
 */

import { supabase } from "./supabaseClient.js";
import { logger } from "./logger.js";

const ENVELOPE_VERSION = 1;

function writePayload(el, status, data, error_code = null) {
  if (!el) return;
  el.textContent = JSON.stringify({ status, version: ENVELOPE_VERSION, data, error_code });
}

function classifyError(error) {
  const msg = String(error?.message ?? "").toLowerCase();
  if (msg.includes("no profile found") || msg.includes("jwt") || msg.includes("not authenticated")) {
    return "not_authenticated";
  }
  if (msg.includes("not attending")) {
    return "not_attending";
  }
  return "unknown";
}

/**
 * Fetch event context for the current authenticated user.
 * Returns the envelope object directly; never throws.
 */
export async function getEventContext(eventId) {
  if (!eventId) {
    return { status: "error", version: ENVELOPE_VERSION, data: null, error_code: "missing_event_id" };
  }

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
    return { status: "error", version: ENVELOPE_VERSION, data: null, error_code: "not_authenticated" };
  }

  const { data, error } = await supabase.rpc("get_event_context", { p_event_id: eventId });

  if (error) {
    return { status: "error", version: ENVELOPE_VERSION, data: null, error_code: classifyError(error) };
  }

  return { status: "ok", version: ENVELOPE_VERSION, data, error_code: null };
}

// ---------------------------------------------------------------------------
// Auto-execute when page loads with ?event= param
// ---------------------------------------------------------------------------

const params  = new URLSearchParams(window.location.search);
const eventId = params.get("event");
const el      = document.getElementById("eventContextPayload");

// Write loading sentinel immediately so iOS knows the page loaded
writePayload(el, "loading", null);

if (eventId) {
  getEventContext(eventId).then((envelope) => {
    writePayload(el, envelope.status, envelope.data, envelope.error_code);
    if (envelope.status !== "ok") {
      logger.warn("[EventContext]", envelope.error_code, envelope);
    }
  });
} else {
  writePayload(el, "error", null, "missing_event_id");
}

// Expose globally for iOS JS bridge (window.webkit.messageHandlers or evaluateJavaScript)
window.NearifyEventContext = { getEventContext };
