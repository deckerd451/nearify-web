/**
 * events.js — Shared events module
 *
 * Identity model:
 *   events.created_by = profiles.id
 *   profiles.auth_user_id = auth.users.id
 *
 * All ownership operations resolve the current user's profile_id first.
 */
import { supabase } from "./supabaseClient.js";

// ---- Profile resolution (cached per session) ----

let _cachedProfileId = null;

/**
 * Resolve the current organizer's profile.id from their auth session.
 * Caches the result for the page lifetime.
 * @returns {Promise<string|null>}
 */
export async function getOrganizerProfileId() {
  if (_cachedProfileId) return _cachedProfileId;

  const { data: sessionData } = await supabase.auth.getSession();
  const authUserId = sessionData?.session?.user?.id;
  if (!authUserId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    console.error("[Events] profile lookup error:", error);
    return null;
  }

  _cachedProfileId = data?.id ?? null;
  if (_cachedProfileId) {
    console.log("[Events] resolved profile_id:", _cachedProfileId);
  } else {
    console.warn("[Events] no profile found for auth_user_id:", authUserId);
  }
  return _cachedProfileId;
}

// ---- Public (no auth) ----

/**
 * Fetch all public events ordered by start date.
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

// ---- Organizer (auth required) ----

/**
 * Save (create or update) an event.
 * Automatically sets created_by to the organizer's profile.id on create.
 * On update (upsert with existing id), created_by is preserved.
 *
 * @param {object} eventFields - { id, name, slug, location, starts_at }
 * @param {boolean} isUpdate - true if editing an existing event
 * @returns {Promise<{data, error}>}
 */
export async function saveEvent(eventFields, isUpdate = false) {
  const profileId = await getOrganizerProfileId();
  if (!profileId) {
    const msg = "Could not resolve your organizer profile. Make sure you have a Nearify profile.";
    console.error("[Events]", msg);
    return { data: null, error: { message: msg } };
  }

  if (isUpdate) {
    // Update: only touch the fields the organizer changed, don't overwrite created_by
    const { id, ...fields } = eventFields;
    const { data, error } = await supabase
      .from("events")
      .update(fields)
      .eq("id", id)
      .eq("created_by", profileId)
      .select();

    if (error) console.error("[Events] updateEvent error:", error);
    return { data, error };
  } else {
    // Create: set created_by to organizer's profile.id
    const payload = { ...eventFields, created_by: profileId };
    const { data, error } = await supabase
      .from("events")
      .insert(payload)
      .select();

    if (error) console.error("[Events] createEvent error:", error);
    return { data, error };
  }
}

/**
 * Delete an event by ID.
 * RLS ensures only the owner (created_by = current_profile_id()) can delete.
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

/**
 * Fetch events created by the current organizer.
 * @returns {Promise<Array>}
 */
export async function fetchOrganizerEvents() {
  const profileId = await getOrganizerProfileId();
  if (!profileId) return [];

  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, location, starts_at, created_at, created_by")
    .eq("created_by", profileId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[Events] fetchOrganizerEvents error:", error);
    return [];
  }
  return data || [];
}
