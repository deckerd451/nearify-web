/**
 * appState.js — Global app state for Nearify Web
 *
 * Single source of truth for:
 * - current authenticated user
 * - current event context
 *
 * All pages import from here instead of managing auth independently.
 */
import { supabase } from "./supabaseClient.js";

const STORAGE_KEY = "nearify_current_event";

/** @returns {Promise<import("@supabase/supabase-js").User | null>} */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("[AppState] getSession error:", error);
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
 * 2. sessionStorage
 */
export function getCurrentEventId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("event");
  if (fromUrl) {
    try { sessionStorage.setItem(STORAGE_KEY, fromUrl); } catch (_) {}
    return fromUrl;
  }
  try { return sessionStorage.getItem(STORAGE_KEY); } catch (_) {}
  return null;
}

/**
 * Persist an event ID into session so other pages can pick it up.
 */
export function setCurrentEventId(eventId) {
  try { sessionStorage.setItem(STORAGE_KEY, eventId); } catch (_) {}
}

console.log("[AppState] loaded");
