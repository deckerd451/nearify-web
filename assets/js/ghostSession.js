import { supabase } from "./supabaseClient.js";

const GHOST_STORAGE_PREFIX = "nearify_ghost";

function getGhostStorageKey(eventId) {
  return `${GHOST_STORAGE_PREFIX}:${eventId}`;
}

export function loadGhostSession(eventId) {
  try {
    const raw = localStorage.getItem(getGhostStorageKey(eventId));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("[Ghost] Failed to load ghost session", error);
    return null;
  }
}

export function saveGhostSession(eventId, session) {
  try {
    localStorage.setItem(getGhostStorageKey(eventId), JSON.stringify(session));
  } catch (error) {
    console.error("[Ghost] Failed to save ghost session", error);
  }
}

export async function createGhostSession(eventId, displayName) {
  const { data, error } = await supabase.rpc("create_ghost_participant", {
    p_event_id: eventId,
    p_display_name: displayName ?? null,
  });

  if (error) {
    console.error("[Ghost] Failed to create ghost participant", error);
    throw error;
  }

  const ghost = Array.isArray(data) ? data[0] : data;
  if (!ghost) {
    throw new Error("Ghost creation returned no data");
  }

  const session = {
    ghostId: ghost.ghost_id,
    ghostToken: ghost.ghost_token,
    eventId: ghost.event_id,
    displayName: ghost.display_name ?? displayName ?? null,
  };

  saveGhostSession(eventId, session);
  return session;
}
