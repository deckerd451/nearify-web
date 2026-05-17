/**
 * adminAccess.js — Client-side admin allowlist helpers.
 *
 * TODO: This client-side allowlist is a temporary safeguard. Move to
 *       server-side / RLS-based role enforcement once a role system exists.
 *
 * TODO: GitHub OAuth users may have hidden/private emails. Google OAuth is
 *       preferred for admin access unless the GitHub email is explicitly
 *       exposed in Supabase user metadata.
 */

// Explicit allowlist of admin email addresses (lowercase).
const ADMIN_EMAILS = [
  "dmhamilton1@live.com",
  "deckerdb26354@gmail.com",
];

/**
 * OAuth-safe email extraction.
 * Checks all locations Supabase may store an OAuth user's email depending
 * on the provider and privacy settings.
 *
 * @param {object} user - Supabase user object from session.user
 * @returns {string|null} Lowercase email or null if none found
 */
export function getUserEmail(user) {
  const email =
    user?.email ||
    user?.user_metadata?.email ||
    user?.app_metadata?.email ||
    user?.identities?.find(i => i.identity_data?.email)?.identity_data?.email;
  return email ? email.toLowerCase() : null;
}

/**
 * Returns true only if the user's email is in the admin allowlist.
 *
 * @param {object} user - Supabase user object
 * @returns {boolean}
 */
export function isAdminUser(user) {
  const email = getUserEmail(user);
  return email !== null && ADMIN_EMAILS.includes(email);
}

/**
 * Shows/hides the three admin page states based on the user's auth + role.
 *
 * States:
 *   "unauthenticated" — no session; shows gateEl, hides others
 *   "forbidden"       — signed in but not allowlisted; shows restrictedEl, hides others
 *   "granted"         — admin; shows contentEl, hides others
 *
 * @param {object|null} user - Supabase user object or null
 * @param {{ gateEl: Element, contentEl: Element, restrictedEl: Element }} options
 * @returns {"unauthenticated"|"forbidden"|"granted"}
 */
export function requireAdminAccess(user, { gateEl, contentEl, restrictedEl } = {}) {
  const show = (el) => { if (el) el.style.display = ""; };
  const hide = (el) => { if (el) el.style.display = "none"; };

  if (!user) {
    show(gateEl);
    hide(contentEl);
    hide(restrictedEl);
    return "unauthenticated";
  }

  if (!isAdminUser(user)) {
    hide(gateEl);
    hide(contentEl);
    show(restrictedEl);
    return "forbidden";
  }

  hide(gateEl);
  show(contentEl);
  hide(restrictedEl);
  return "granted";
}
