import { supabase } from "./supabaseClient.js";
import { loadGhostSession } from "./ghostSession.js";

export async function connectGhostToProfile(eventId, targetProfileId) {
  const ghost = loadGhostSession(eventId);

  if (!ghost?.ghostToken) {
    console.error("[Ghost] No ghost session found");
    throw new Error("No ghost session");
  }

  const { data, error } = await supabase.rpc("record_ghost_connection", {
    p_event_id: eventId,
    p_ghost_token: ghost.ghostToken,
    p_target_profile_id: targetProfileId,
  });

  if (error) {
    console.error("[Ghost] Failed to record connection", error);
    throw error;
  }

  console.log("[Ghost] Connection recorded", data);
  return data;
}
