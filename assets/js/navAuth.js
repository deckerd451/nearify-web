import { supabase } from "./supabaseClient.js";

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
// Sign-out
// ---------------------------------------------------------------------------

async function handleSignOut() {
  await supabase.auth.signOut();
  window.location.href = window.location.origin + "/";
}

// ---------------------------------------------------------------------------
// Inject / remove
// ---------------------------------------------------------------------------

function injectSignedIn(profile, email) {
  document.querySelectorAll(".nav-user-wrapper").forEach((el) => el.remove());
  document.querySelectorAll(".nav-drawer-signout").forEach((el) => el.remove());

  const navLinks = document.querySelector(".nav-links");
  if (navLinks) navLinks.appendChild(buildPill(profile, email));

  const drawer = document.getElementById("navDrawer");
  if (drawer) drawer.appendChild(buildDrawerSignOut());
}

function removeSignedIn() {
  document.querySelectorAll(".nav-user-wrapper").forEach((el) => el.remove());
  document.querySelectorAll(".nav-drawer-signout").forEach((el) => el.remove());
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initNavAuth() {
  initHamburger();

  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      fetchProfile(session.user.id)
        .then((profile) => injectSignedIn(profile, session.user.email))
        .catch(() => injectSignedIn(null, session.user.email));
    } else {
      removeSignedIn();
    }
  });
}

initNavAuth();
