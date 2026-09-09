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

// Per-session cache so we don't re-hit the RPC on every auth event.
let _isAdminCache = null; // boolean once resolved

/**
 * Reset the cached admin result (e.g. on sign-out). Exposed for completeness.
 */
export function resetAdminCache() {
  _isAdminCache = null;
}

/**
 * Ask the server whether the current session is an admin.
 * Fails CLOSED (returns false) on any error — never grants on ambiguity.
 *
 * @param {object} supabase - Supabase client
 * @returns {Promise<boolean>}
 */
export async function fetchIsAdmin(supabase) {
  if (_isAdminCache !== null) return _isAdminCache;
  try {
    const { data, error } = await supabase.rpc("is_admin");
    if (error) {
      _isAdminCache = false;
      return false;
    }
    _isAdminCache = data === true;
    return _isAdminCache;
  } catch {
    _isAdminCache = false;
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
  const isAdmin = await fetchIsAdmin(supabase);
  return renderAdminGate(
    isAdmin ? ADMIN_STATE.GRANTED : ADMIN_STATE.FORBIDDEN,
    els
  );
}
