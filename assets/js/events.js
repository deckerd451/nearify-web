/**
 * events.js — Shared events module
 *
 * Provides event CRUD for organizer pages and
 * public event fetching for homepage/events pages.
 */
import { supabase } from "./supabaseClient.js";

/**
 * Fetch all public events, newest first.
 * No auth required — relies on RLS SELECT policy.
 * @returns {Promise<Array>}
 */
export async function fetchPublicEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, location, starts_at, created_at")
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(50);

  if (error) {
    console.error("[Events] fetchPublicEvents error:", error);
    return [];
  }
  return data || [];
}

/**
 * Save (upsert) an event. Works for both create and edit.
 * @param {object} event - { id, name, slug, location, starts_at }
 * @returns {Promise<{data, error}>}
 */
export async function saveEvent(event) {
  const { data, error } = await supabase
    .from("events")
    .upsert(event, { onConflict: "id" })
    .select();

  if (error) console.error("[Events] saveEvent error:", error);
  return { data, error };
}

/**
 * Delete an event by ID.
 * @param {string} eventId
 * @returns {Promise<{error}>}
 */
export async function deleteEvent(eventId) {
  const { error } = await supabase
    .from("events")
    .delete()
    .eq("id", eventId);

  if (error) console.error("[Events] deleteEvent error:", error);
  return { error };
}
