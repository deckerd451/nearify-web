/**
 * appState.js — Global app state for Nearify Web
 *
 * Single source of truth for:
 * - current authenticated user
 * - current event context
 *
 * All pages import from here instead of managing auth independently.
 */
import { supabase, getSessionCached } from "./supabaseClient.js";
import { logger } from "./logger.js";

// localStorage so event context survives browser close (post-event intelligence)
const STORAGE_KEY = "nearify_current_event";

/** @returns {Promise<import("@supabase/supabase-js").User | null>} */
export async function getCurrentUser() {
  const { data, error } = await getSessionCached();
  if (error) {
    logger.error("[AppState] getSession error:", error);
    return null;
  }
  return data.session?.user ?? null;
}

/** Synchronous check — true only after getCurrentUser resolved a session */
export function isAuthenticated() {
  // supabase-js v2 stores session in memory after getSession()
  // This is a lightweight sync check for UI gating
  return !!supabase.auth.session?.user;
}

/**
 * Resolve the current event ID from (in priority order):
 * 1. URL ?event= parameter
 * 2. localStorage
 */
export function getCurrentEventId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("event");
  if (fromUrl) {
    try { localStorage.setItem(STORAGE_KEY, fromUrl); } catch (_) {}
    return fromUrl;
  }
  try { return localStorage.getItem(STORAGE_KEY); } catch (_) {}
  return null;
}

/**
 * Persist an event ID so other pages and future sessions can pick it up.
 */
export function setCurrentEventId(eventId) {
  try { localStorage.setItem(STORAGE_KEY, eventId); } catch (_) {}
}

logger.log("[AppState] loaded");
