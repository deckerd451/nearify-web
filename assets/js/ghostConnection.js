import { supabase, createScopedSupabaseClient } from "./supabaseClient.js";
import { loadGhostSession } from "./ghostSession.js";
import { logger } from "./logger.js";
import { guestSaveFailure, guestSaveDiagnostic } from "./guestSaveDiagnostic.js";

// Only the caller's token-authorized history can establish an existing save.
async function findOwnSave(ghost, eventId, profileId) {
  if (!ghost.ghostId) return null;
  try {
    const scoped = createScopedSupabaseClient({"x-ghost-token":ghost.ghostToken});
    const {data,error} = await scoped.rpc("get_ghost_connection_history", {
      p_ghost_id:ghost.ghostId,p_ghost_token:ghost.ghostToken,p_event_id:eventId,
    });
    if (error || !Array.isArray(data)) return null;
    return data.find(row => String(row.event_id).toLowerCase() === eventId.toLowerCase()
      && String(row.to_profile_id).toLowerCase() === profileId.toLowerCase()) || null;
  } catch (_) { return null; }
}

export async function connectGhostToProfile(eventId, profileId) {
  if (!eventId || !profileId) return null;
  const ghost = loadGhostSession(eventId);
  if (!ghost?.ghostToken) throw guestSaveFailure({code:'GUEST_SESSION_MISSING'});

  const existing = await findOwnSave(ghost,eventId,profileId);
  if (existing) return existing;

  let response;
  try {
    response = await supabase.rpc("record_ghost_connection", {
      p_event_id:eventId,p_ghost_token:ghost.ghostToken,p_target_profile_id:profileId,
    });
  } catch (error) { throw guestSaveFailure(error); }
  if (response.error) {
    // A concurrent/repeated scan may have saved it. Verify the exact event and
    // person before treating any failed request (including 23505) as success.
    const saved = await findOwnSave(ghost,eventId,profileId);
    if (saved) return saved;
    const failure = guestSaveFailure(response.error,response.status);
    logger.error('[GhostConnection] save failed',guestSaveDiagnostic(failure));
    throw failure;
  }
  const saved = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!saved) throw guestSaveFailure({code:'EMPTY_SAVE_RESPONSE'},response.status);
  return saved;
}
