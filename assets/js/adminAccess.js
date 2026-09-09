/**
 * adminAccess.js — Client helpers for the canonical, server-side admin check.
 *
 * Source of truth for admin membership is the database (public.admins table,
 * checked via the public.is_admin() RPC). This module deliberately contains NO
 * email allowlist and performs NO client-side identity comparison — it only
 * asks the server whether the current session is an admin, and renders UI gates
 * from that answer. Backend RLS remains authoritative even if these client
 * checks are bypassed.
 */

// Access states used by every admin/creation gate.
export const ADMIN_STATE = {
  LOADING: "loading",             // auth/authorization not resolved yet
  UNAUTHENTICATED: "unauthenticated", // no session
  FORBIDDEN: "forbidden",         // signed in, not an admin
  GRANTED: "granted",             // signed in and an admin
};

// Per-authenticated-user cache so we don't re-hit the RPC on every auth event,
// while never serving a stale result across an account switch. We remember WHO
// the cached answer belongs to; if the current user id differs (sign-out,
// sign-in, or switching accounts), the cache is treated as a miss.
let _adminCache = { userId: null, value: null }; // value: boolean once resolved

/**
 * Reset the cached admin result (e.g. on sign-out / account change).
 */
export function resetAdminCache() {
  _adminCache = { userId: null, value: null };
}

/**
 * Ask the server whether the current session is an admin, caching the answer
 * per authenticated user id. Passing a different (or null) userId than the
 * cached one forces a re-check, so an admin → non-admin switch never serves a
 * stale "true". Fails CLOSED (returns false) on any error.
 *
 * @param {object} supabase - Supabase client
 * @param {string|null} [userId] - current authenticated user id (session.user.id)
 * @returns {Promise<boolean>}
 */
export async function fetchIsAdmin(supabase, userId = null) {
  // No user id supplied → resolve it from the client so callers that don't have
  // a session handy still get correct per-user behavior.
  if (userId === null) {
    try {
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch {
      userId = null;
    }
  }

  // No authenticated user → not an admin, and clear any prior cache.
  if (!userId) {
    resetAdminCache();
    return false;
  }

  // Cache hit only when it belongs to the SAME user.
  if (_adminCache.userId === userId && _adminCache.value !== null) {
    return _adminCache.value;
  }

  try {
    const { data, error } = await supabase.rpc("is_admin");
    const value = !error && data === true;
    _adminCache = { userId, value };
    return value;
  } catch {
    _adminCache = { userId, value: false };
    return false;
  }
}

/**
 * Pure DOM renderer for the three visible states (plus loading).
 * Only touches element.style.display, so it is trivially unit-testable.
 *
 * @param {"loading"|"unauthenticated"|"forbidden"|"granted"} state
 * @param {{ gateEl?: Element, contentEl?: Element, restrictedEl?: Element }} els
 * @returns {string} the state passed in
 */
export function renderAdminGate(state, { gateEl, contentEl, restrictedEl } = {}) {
  const show = (el) => { if (el) el.style.display = ""; };
  const hide = (el) => { if (el) el.style.display = "none"; };

  // Default: everything hidden. This guarantees no admin content flashes while
  // authorization is loading.
  hide(gateEl);
  hide(contentEl);
  hide(restrictedEl);

  switch (state) {
    case ADMIN_STATE.UNAUTHENTICATED:
      show(gateEl);
      break;
    case ADMIN_STATE.FORBIDDEN:
      show(restrictedEl);
      break;
    case ADMIN_STATE.GRANTED:
      show(contentEl);
      break;
    case ADMIN_STATE.LOADING:
    default:
      // keep everything hidden
      break;
  }
  return state;
}

/**
 * Resolve admin access for the current session using the SERVER result, then
 * render the gate. Content stays hidden until the server answers (no flash).
 *
 * @param {object} supabase - Supabase client
 * @param {object|null} session - Supabase session (session.user implies signed in)
 * @param {{ gateEl?: Element, contentEl?: Element, restrictedEl?: Element }} els
 * @returns {Promise<"unauthenticated"|"forbidden"|"granted">}
 */
export async function resolveAdminAccess(supabase, session, els = {}) {
  if (!session?.user) {
    resetAdminCache();
    return renderAdminGate(ADMIN_STATE.UNAUTHENTICATED, els);
  }
  // Keep everything hidden while we ask the server.
  renderAdminGate(ADMIN_STATE.LOADING, els);
  const isAdmin = await fetchIsAdmin(supabase, session.user.id);
  return renderAdminGate(
    isAdmin ? ADMIN_STATE.GRANTED : ADMIN_STATE.FORBIDDEN,
    els
  );
}
