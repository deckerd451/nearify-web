/**
 * events.js — Shared events module
 *
 * Identity model:
 *   events.created_by = profiles.id
 *   profiles.user_id = auth.users.id
 *
 * All ownership operations resolve the current user's profile_id first.
 */
import { supabase } from "./supabaseClient.js";
import { logger } from "./logger.js";

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
    .eq("user_id", authUserId)
    .maybeSingle();

  if (error) {
    logger.error("[Events] profile lookup error:", error);
    return null;
  }

  _cachedProfileId = data?.id ?? null;
  if (_cachedProfileId) {
    logger.log("[Events] resolved profile_id:", _cachedProfileId);
  } else {
    logger.warn("[Events] no profile found for user_id:", authUserId);
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
    .select("id, name, slug, location, starts_at, description, created_at, created_by")
    .is("deleted_at", null)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(50);

  if (error) {
    logger.error("[Events] fetchPublicEvents error:", error);
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
    logger.error("[Events]", msg);
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

    if (error) logger.error("[Events] updateEvent error:", error);
    return { data, error };
  } else {
    // Create: set created_by to organizer's profile.id
    const payload = { ...eventFields, created_by: profileId };
    const { data, error } = await supabase
      .from("events")
      .insert(payload)
      .select();

    if (error) logger.error("[Events] createEvent error:", error);
    return { data, error };
  }
}

/**
 * Soft-delete an event by setting deleted_at.
 * Preserves historical interaction data (no FK conflicts).
 * RLS ensures only the owner can update.
 * @param {string} eventId
 * @returns {Promise<{error}>}
 */
export async function deleteEvent(eventId) {
  const { error } = await supabase
    .from("events")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", eventId);

  if (error) logger.error("[Events] deleteEvent (soft) error:", error);
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
    .select("id, name, slug, location, starts_at, ends_at, is_active, description, created_at, created_by")
    .eq("created_by", profileId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logger.error("[Events] fetchOrganizerEvents error:", error);
    return [];
  }
  return data || [];
}

/**
 * Returns true if the currently authenticated user created this event.
 * Compares their resolved profile.id against event.created_by.
 * No extra DB queries — created_by is already on every fetched event row.
 * @param {object} event - Event row (must include created_by)
 * @returns {Promise<boolean>}
 */
export async function canManageEvent(event) {
  if (!event?.created_by) return false;
  const profileId = await getOrganizerProfileId();
  return !!profileId && profileId === event.created_by;
}
