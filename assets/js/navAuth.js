/**
 * navAuth.js — Signed-in user indicator for the nav bar
 *
 * Import this module on any page that has a .nav header.
 * If the user is authenticated, a user pill (avatar + name) is injected
 * into .nav-links. Silent and non-blocking — never affects page load.
 */
import { supabase } from "./supabaseClient.js";

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function injectUserPill(user) {
  const navLinks = document.querySelector(".nav-links");
  if (!navLinks) return;

  const name =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "You";

  const firstName = name.split(/\s+/)[0];
  const initials  = getInitials(name);
  const avatarUrl = user.user_metadata?.avatar_url;

  const avatarHtml = avatarUrl
    ? `<img class="nav-avatar" src="${escapeAttr(avatarUrl)}" alt="${escapeAttr(firstName)}" />`
    : `<span class="nav-avatar-placeholder">${initials}</span>`;

  const pill = document.createElement("div");
  pill.className = "nav-user";
  pill.title = user.email || name;
  pill.innerHTML = `${avatarHtml}<span class="nav-user-name">${escapeAttr(firstName)}</span>`;

  navLinks.appendChild(pill);
}

async function initNavAuth() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) return;
    injectUserPill(data.session.user);
  } catch (e) {
    // Non-fatal — nav still works without this
    console.warn("[navAuth] Could not resolve session:", e.message);
  }
}

initNavAuth();
