/**
 * navAuth.js — Signed-in user indicator + sign-out for the nav bar
 *
 * Import this module on any page that has a .nav header.
 * If the user is authenticated, a user pill (avatar + name) is injected
 * into .nav-links. Clicking the pill opens a small dropdown with the
 * user's email and a Sign out button. Silent and non-blocking.
 */
import { supabase } from "./supabaseClient.js";

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str);
  return d.innerHTML;
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
  const email     = user.email || "";

  const avatarHtml = avatarUrl
    ? `<img class="nav-avatar" src="${escapeAttr(avatarUrl)}" alt="${escapeAttr(firstName)}" />`
    : `<span class="nav-avatar-placeholder">${escapeHtml(initials)}</span>`;

  // Pill
  const pill = document.createElement("div");
  pill.className = "nav-user";
  pill.setAttribute("role", "button");
  pill.setAttribute("aria-haspopup", "true");
  pill.setAttribute("aria-expanded", "false");
  pill.innerHTML =
    `${avatarHtml}` +
    `<span class="nav-user-name">${escapeHtml(firstName)}</span>` +
    `<span class="nav-user-chevron" aria-hidden="true">▾</span>`;

  // Dropdown
  const dropdown = document.createElement("div");
  dropdown.className = "nav-dropdown";
  dropdown.setAttribute("role", "menu");
  dropdown.innerHTML =
    `<div class="nav-dropdown-email">${escapeHtml(email || name)}</div>` +
    `<button class="nav-dropdown-signout" type="button">Sign out</button>`;

  // Wrap both in a positioned container
  const wrapper = document.createElement("div");
  wrapper.className = "nav-user-wrapper";
  wrapper.appendChild(pill);
  wrapper.appendChild(dropdown);
  navLinks.appendChild(wrapper);

  // Toggle dropdown on pill click
  pill.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = wrapper.classList.toggle("open");
    pill.setAttribute("aria-expanded", String(open));
  });

  // Sign out
  dropdown.querySelector(".nav-dropdown-signout").addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } catch (_) { /* best-effort */ }
    // Reload to clear all auth-gated UI
    window.location.reload();
  });

  // Close when clicking anywhere outside
  document.addEventListener("click", () => {
    wrapper.classList.remove("open");
    pill.setAttribute("aria-expanded", "false");
  });
}

async function initNavAuth() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) return;
    injectUserPill(data.session.user);
  } catch (e) {
    console.warn("[navAuth] Could not resolve session:", e.message);
  }
}

initNavAuth();

// ---- Hamburger menu toggle ----
function initHamburger() {
  const btn    = document.getElementById("navHamburger");
  const drawer = document.getElementById("navDrawer");
  if (!btn || !drawer) return;

  function close() {
    drawer.classList.remove("open");
    btn.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = drawer.classList.toggle("open");
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  });

  // Close when a drawer link is clicked
  drawer.querySelectorAll("a").forEach(a => a.addEventListener("click", close));

  // Close on outside click
  document.addEventListener("click", close);
}

initHamburger();
