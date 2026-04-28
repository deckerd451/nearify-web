import { supabase } from "./supabaseClient.js";
import { APP_STORE_URL, patchAppStoreLinks } from "./config.js";
import { trackPageView, trackAppCtaClick } from "./analytics.js";

function getInitials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str ?? "");
  return d.innerHTML;
}

function showState(id) {
  ["profileSkeleton", "profileContent", "profileNotFound"].forEach((s) => {
    const el = document.getElementById(s);
    if (el) el.hidden = s !== id;
  });
}

function renderProfile(profile, eventId, eventName) {
  const name     = profile.name || "Attendee";
  const initials = getInitials(name);

  const avatarEl = document.getElementById("profileAvatar");
  if (avatarEl) {
    avatarEl.innerHTML = profile.avatar_url
      ? `<img class="profile-avatar-img" src="${escapeHtml(profile.avatar_url)}" alt="${escapeHtml(initials)}" />`
      : `<div class="profile-avatar-placeholder">${escapeHtml(initials)}</div>`;
  }

  const nameEl = document.getElementById("profileName");
  if (nameEl) nameEl.textContent = name;

  const contextEl = document.getElementById("profileContext");
  if (contextEl) contextEl.textContent = eventName ? `Attending ${eventName}` : "Nearify member";

  const openAppBtn = document.getElementById("profileOpenAppBtn");
  const getAppLink = document.getElementById("profileGetAppLink");

  if (openAppBtn && eventId) {
    const deepLink = `beacon://event/${encodeURIComponent(eventId)}`;
    openAppBtn.addEventListener("click", () => {
      trackAppCtaClick("profile_open_app", { eventId });
      window.location.href = deepLink;
      setTimeout(() => {
        const fallback = document.getElementById("profileGetAppFallback");
        if (fallback && document.visibilityState === "visible") fallback.hidden = false;
      }, 1200);
    });
  } else if (openAppBtn) {
    openAppBtn.addEventListener("click", () => {
      trackAppCtaClick("profile_get_app");
      window.location.href = APP_STORE_URL;
    });
    openAppBtn.textContent = "Get the App";
    if (getAppLink) getAppLink.hidden = true;
  }

  showState("profileContent");
}

async function init() {
  patchAppStoreLinks();

  const params    = new URLSearchParams(window.location.search);
  const profileId = params.get("id");
  const eventId   = params.get("event");

  trackPageView({ profileId: profileId ?? undefined, eventId: eventId ?? undefined });

  if (!profileId) {
    showState("profileNotFound");
    return;
  }

  const { data: rows, error } = await supabase.rpc("get_public_profile_brief", {
    p_profile_id: profileId,
  });

  if (error || !rows?.length) {
    showState("profileNotFound");
    return;
  }

  let eventName = null;
  if (eventId) {
    const { data: event } = await supabase
      .from("events")
      .select("name")
      .eq("id", eventId)
      .maybeSingle();
    eventName = event?.name ?? null;
  }

  renderProfile(rows[0], eventId, eventName);
}

init();
