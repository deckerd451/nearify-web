/**
 * events.js — Shared events module
 *
 * Identity model:
 *   events.created_by = profiles.id
 *   profiles.user_id = auth.users.id
 *
 * All ownership operations resolve the current user's profile_id first.
 */
import { supabase, getSessionCached } from "./supabaseClient.js";
import { dedupeRequest } from "./supabaseLoad.js";
import { logger } from "./logger.js";

// ---- Profile resolution (cached per session) ----

let _cachedProfileId = null;
const EVENT_CACHE_TTL_MS = 180000;
const eventReadCache = new Map();

function getEventCache(key) {
  const hit = eventReadCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    logger.log("[SupabaseLoad] event read cache hit", key);
    return hit.value;
  }
  eventReadCache.delete(key);
  return null;
}

function setEventCache(key, value) {
  eventReadCache.set(key, { value, expiresAt: Date.now() + EVENT_CACHE_TTL_MS });
}

function invalidateEventReadCache() {
  eventReadCache.clear();
}

/**
 * Resolve the current organizer's profile.id from their auth session.
 * Caches the result for the page lifetime.
 * @returns {Promise<string|null>}
 */
export async function getOrganizerProfileId() {
  if (_cachedProfileId) return _cachedProfileId;

  const { data: sessionData } = await getSessionCached();
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
  const key = "public-events";
  const hit = getEventCache(key);
  if (hit) return hit;
  logger.log("[SupabaseLoad] event read deduped", key);
  const { data, error } = await dedupeRequest(`events:${key}`, () => supabase
    .from("events")
    .select("id, name, slug, location, starts_at, description, created_at")
    .is("deleted_at", null)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(50));

  if (error) {
    logger.error("[Events] fetchPublicEvents error:", error);
    return [];
  }
  const events = data || [];
  setEventCache(key, events);
  return events;
}

// ---- Organizer (auth required) ----

/**
 * Save (create or update) an event.
 * On create, sets created_by only when isOrganizer is true.
 * On update, created_by is preserved.
 *
 * @param {object} eventFields - { id, name, slug, location, starts_at }
 * @param {boolean} isUpdate - true if editing an existing event
 * @param {boolean} isOrganizer - if true, set created_by on create
 * @returns {Promise<{data, error}>}
 */
export async function saveEvent(eventFields, isUpdate = false, isOrganizer = true) {
  const profileId = await getOrganizerProfileId();
  if (!profileId) {
    const msg = "Could not resolve your organizer profile. Make sure you have a Nearify profile.";
    logger.error("[Events]", msg);
    return { data: null, error: { message: msg } };
  }

  if (isUpdate) {
    const { id, ...fields } = eventFields;
    const { data, error } = await supabase
      .from("events")
      .update(fields)
      .eq("id", id)
      .eq("created_by", profileId)
      .select();

    if (error) logger.error("[Events] updateEvent error:", error);
    if (!error) invalidateEventReadCache();
    return { data, error };
  } else {
    const payload = {
      ...eventFields,
      ...(isOrganizer ? { created_by: profileId } : { created_by: null }),
    };
    const { data, error } = await supabase
      .from("events")
      .insert(payload)
      .select();

    if (error) logger.error("[Events] createEvent error:", error);
    if (!error) invalidateEventReadCache();
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
  if (!error) invalidateEventReadCache();
  return { error };
}

/**
 * Fetch events created by the current organizer.
 * @returns {Promise<Array>}
 */
export async function fetchOrganizerEvents() {
  const profileId = await getOrganizerProfileId();
  if (!profileId) return [];
  const key = `organizer-events:${profileId}`;
  const hit = getEventCache(key);
  if (hit) return hit;
  logger.log("[SupabaseLoad] event read deduped", key);

  const { data, error } = await dedupeRequest(`events:${key}`, () => supabase
    .from("events")
    .select("id, name, slug, location, starts_at, ends_at, is_active, description, created_at, created_by")
    .eq("created_by", profileId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50));

  if (error) {
    logger.error("[Events] fetchOrganizerEvents error:", error);
    return [];
  }
  const events = data || [];
  setEventCache(key, events);
  return events;
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
