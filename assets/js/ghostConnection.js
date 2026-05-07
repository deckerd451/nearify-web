import { supabase } from "./supabaseClient.js";
import { loadGhostSession } from "./ghostSession.js";
import { logger } from "./logger.js";

/**
 * Record a connection between the current ghost participant and a profile.
 * Called when an app-less user lands on a personal connect URL (?event=&profile=).
 * The ghost token authenticates the write — no user session required.
 */
export async function connectGhostToProfile(eventId, profileId) {
  if (!eventId || !profileId) return null;

  const ghost = loadGhostSession(eventId);
  if (!ghost?.ghostToken) {
    logger.warn("[GhostConnection] No ghost session found for event", eventId);
    return null;
  }

  const { data, error } = await supabase.rpc("record_ghost_connection", {
    p_event_id: eventId,
    p_ghost_token: ghost.ghostToken,
    p_target_profile_id: profileId,
  });

  if (error) {
    logger.error("[GhostConnection] record_ghost_connection failed", error);
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;
  logger.log("[GhostConnection] connection recorded", result);
  return result;
}
