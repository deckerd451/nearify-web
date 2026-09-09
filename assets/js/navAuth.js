import { supabase } from "./supabaseClient.js";
import { fetchIsAdmin, resetAdminCache } from "./adminAccess.js";

// ---------------------------------------------------------------------------
// Hamburger / nav-drawer toggle (wired here since this module loads on every page)
// ---------------------------------------------------------------------------

function initHamburger() {
  const hamburger = document.getElementById("navHamburger");
  const drawer    = document.getElementById("navDrawer");
  if (!hamburger || !drawer) return;

  hamburger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = drawer.classList.toggle("open");
    hamburger.classList.toggle("open", isOpen);
    hamburger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  document.addEventListener("click", (e) => {
    if (!drawer.contains(e.target) && !hamburger.contains(e.target)) {
      drawer.classList.remove("open");
      hamburger.classList.remove("open");
      hamburger.setAttribute("aria-expanded", "false");
    }
  });
}

// ---------------------------------------------------------------------------
// Profile fetch
// ---------------------------------------------------------------------------

async function fetchProfile(userId) {
  const { data } = await supabase
    .from("profiles")
    .select("name, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Nav pill (desktop .nav-links)
// ---------------------------------------------------------------------------

function getInitials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function buildPill(profile, email) {
  const name     = profile?.name || email?.split("@")[0] || "Account";
  const initials = getInitials(name);

  const wrapper = document.createElement("div");
  wrapper.className = "nav-user-wrapper";

  const btn = document.createElement("button");
  btn.className = "nav-user";
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");

  if (profile?.avatar_url) {
    const img = document.createElement("img");
    img.className = "nav-avatar";
    img.src = profile.avatar_url;
    img.alt = name;
    btn.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "nav-avatar-placeholder";
    ph.textContent = initials;
    btn.appendChild(ph);
  }

  const nameEl = document.createElement("span");
  nameEl.className = "nav-user-name";
  nameEl.textContent = name;
  btn.appendChild(nameEl);

  const chevron = document.createElement("span");
  chevron.className = "nav-user-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  btn.appendChild(chevron);

  const dropdown = document.createElement("div");
  dropdown.className = "nav-dropdown";
  dropdown.setAttribute("role", "menu");

  const emailEl = document.createElement("div");
  emailEl.className = "nav-dropdown-email";
  emailEl.textContent = email || "";
  dropdown.appendChild(emailEl);

  const signOutBtn = document.createElement("button");
  signOutBtn.className = "nav-dropdown-signout";
  signOutBtn.type = "button";
  signOutBtn.textContent = "Sign out";
  signOutBtn.addEventListener("click", handleSignOut);
  dropdown.appendChild(signOutBtn);

  wrapper.appendChild(btn);
  wrapper.appendChild(dropdown);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = wrapper.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  document.addEventListener("click", () => {
    wrapper.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  });

  return wrapper;
}

// ---------------------------------------------------------------------------
// Nav-drawer sign-out entry (mobile hamburger menu)
// ---------------------------------------------------------------------------

function buildDrawerSignOut() {
  const btn = document.createElement("button");
  btn.className = "nav-drawer-signout";
  btn.type = "button";
  btn.textContent = "Sign out";
  btn.addEventListener("click", handleSignOut);
  return btn;
}

// ---------------------------------------------------------------------------
// Home link (signed-in primary nav) — links to the personalized dashboard and
// shows the active-page state when the user is on "/" or "/index.html".
// ---------------------------------------------------------------------------

function buildHomeLink() {
  const link = document.createElement("a");
  link.href = "/index.html";
  link.textContent = "Home";
  link.className = "nav-auth-link nav-home-link";
  const path = window.location.pathname;
  if (path === "/" || path === "/index.html") {
    link.setAttribute("aria-current", "page");
  }
  return link;
}

// ---------------------------------------------------------------------------
// Sign-out
// ---------------------------------------------------------------------------

async function handleSignOut() {
  await supabase.auth.signOut();
  window.location.href = window.location.origin + "/";
}

// ---------------------------------------------------------------------------
// Inject / remove
// ---------------------------------------------------------------------------

function injectSignedIn(profile, email, user) {
  document.querySelectorAll(".nav-user-wrapper").forEach((el) => el.remove());
  document.querySelectorAll(".nav-drawer-signout").forEach((el) => el.remove());
  document.querySelectorAll(".nav-auth-link").forEach((el) => el.remove());

  const navLinks = document.querySelector(".nav-links");
  if (navLinks) {
    // Home is the personalized dashboard. Signed-in users get it as the first
    // primary nav item, linking to /index.html.
    const homeLink = buildHomeLink();
    navLinks.insertBefore(homeLink, navLinks.firstChild);

    const networkLink = document.createElement("a");
    networkLink.href = "/connections/";
    networkLink.textContent = "My Connections";
    networkLink.className = "nav-auth-link";
    navLinks.appendChild(networkLink);
    navLinks.appendChild(buildPill(profile, email));
  }

  const drawer = document.getElementById("navDrawer");
  if (drawer) {
    const drawerHome = buildHomeLink();
    drawer.insertBefore(drawerHome, drawer.firstChild);

    const drawerNetwork = document.createElement("a");
    drawerNetwork.href = "/connections/";
    drawerNetwork.textContent = "My Connections";
    drawerNetwork.className = "nav-auth-link";
    drawer.appendChild(drawerNetwork);
    drawer.appendChild(buildDrawerSignOut());
  }

  // Admin link is added only after the SERVER confirms admin membership, so it
  // never flashes for non-admins. Cache is keyed by user id; we also re-check
  // the current user id when the promise resolves so a fast account switch
  // cannot inject an admin link for the wrong (now signed-in) user.
  const injectedForUserId = user?.id ?? null;
  fetchIsAdmin(supabase, injectedForUserId).then((admin) => {
    if (!admin) return;
    if (_currentUserId !== injectedForUserId) return; // account changed mid-flight
    if (navLinks) {
      const adminLink = document.createElement("a");
      adminLink.href = "/admin/";
      adminLink.textContent = "Admin";
      adminLink.className = "nav-auth-link nav-admin-link";
      // Keep the account pill last.
      const pill = navLinks.querySelector(".nav-user-wrapper");
      navLinks.insertBefore(adminLink, pill || null);
    }
    const d = document.getElementById("navDrawer");
    if (d) {
      const drawerAdmin = document.createElement("a");
      drawerAdmin.href = "/admin/";
      drawerAdmin.textContent = "Admin";
      drawerAdmin.className = "nav-auth-link nav-admin-link";
      const signOut = d.querySelector(".nav-drawer-signout");
      d.insertBefore(drawerAdmin, signOut || null);
    }
  }).catch(() => { /* fail closed: no admin link */ });
}

function removeSignedIn() {
  document.querySelectorAll(".nav-user-wrapper").forEach((el) => el.remove());
  document.querySelectorAll(".nav-drawer-signout").forEach((el) => el.remove());
  document.querySelectorAll(".nav-auth-link").forEach((el) => el.remove());
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initNavAuth() {
  initHamburger();

  supabase.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user?.id ?? null;
    // On any change of authenticated user (sign-in, sign-out, or account
    // switch), drop the cached admin result so it can never leak across users.
    if (nextUserId !== _currentUserId) {
      resetAdminCache();
      _currentUserId = nextUserId;
    }

    if (session?.user) {
      const user = session.user;
      fetchProfile(user.id)
        .then((profile) => injectSignedIn(profile, user.email, user))
        .catch(() => injectSignedIn(null, user.email, user));
    } else {
      removeSignedIn();
    }
  });
}

// Tracks the currently authenticated user id so async admin checks can detect
// an account switch that happened while they were in flight.
let _currentUserId = null;

initNavAuth();
