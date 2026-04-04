/**
 * Event Context API — consumed by iOS app
 *
 * Usage (from iOS WKWebView or direct fetch):
 *   GET /event-context?event=<uuid>
 *
 * Since this is a static site, the iOS app calls the Supabase RPC directly.
 * This module provides the client-side helper and can be loaded in any page.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://unndeygygkgodmmdnlup.supabase.co";
const supabaseKey = "sb_publishable_G0KAfCFTovYCWDeEEKWBfg_8UpPHWWZ";

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetch event context for the current authenticated user.
 * @param {string} eventId - UUID of the event
 * @returns {Promise<object>} - { event_id, profile_id, intent_primary, ... }
 */
export async function getEventContext(eventId) {
  const { data, error } = await supabase.rpc("get_event_context", {
    p_event_id: eventId
  });

  if (error) {
    console.error("[EventContext] Error:", error);
    throw error;
  }

  return data;
}

// Expose globally for iOS bridge
window.NearifyEventContext = { getEventContext };

// Auto-execute if loaded with ?event= param (acts as pseudo-endpoint)
const params = new URLSearchParams(window.location.search);
const eventId = params.get("event");

if (eventId) {
  getEventContext(eventId)
    .then((ctx) => {
      console.log("[EventContext] Loaded:", ctx);
      // Write to DOM for iOS WKWebView extraction
      const el = document.getElementById("eventContextPayload");
      if (el) el.textContent = JSON.stringify(ctx);
    })
    .catch((err) => {
      console.error("[EventContext] Failed:", err);
    });
}
