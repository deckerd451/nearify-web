import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("[Join] join.js loaded");

const supabaseUrl = "https://unndeygygkgodmmdnlup.supabase.co";
const supabaseKey = "sb_publishable_G0KAfCFTovYCWDeEEKWBfg_8UpPHWWZ";

const supabase = createClient(supabaseUrl, supabaseKey);
window.supabase = supabase;

const TESTFLIGHT_URL = "https://testflight.apple.com/join/ZayvEbAy";
const APP_OPEN_DELAY_MS = 500;
const APP_FALLBACK_DELAY_MS = 2200;

const params = new URLSearchParams(window.location.search);
const eventId = params.get("event");
const eventName = params.get("name") || "this event";

const titleEl = document.getElementById("joinTitle");
const payloadEl = document.getElementById("payloadText");
const topBtn = document.getElementById("openNearifyBtn");
const bottomBtn = document.getElementById("openNearifyBtnBottom");
const signInBtn = document.getElementById("signInBtn");
const descEl = document.getElementById("joinDescription");
const qrBox = document.getElementById("joinQrBox");
const qrContainer = document.getElementById("joinQrCode");

const deepLink = eventId ? `beacon://event/${eventId}` : "#";
const currentJoinUrl = window.location.href;

let appOpened = false;
let autoJoinAttempted = false;
let joinInProgress = false;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    appOpened = true;
    console.log("[Join] App switch detected");
  }
});

function setDescription(text) {
  if (descEl) descEl.textContent = text;
}

function setButtonsEnabled(enabled) {
  if (topBtn) topBtn.toggleAttribute("aria-disabled", !enabled);
  if (bottomBtn) bottomBtn.toggleAttribute("aria-disabled", !enabled);

  if (topBtn) topBtn.style.pointerEvents = enabled ? "auto" : "none";
  if (bottomBtn) bottomBtn.style.pointerEvents = enabled ? "auto" : "none";

  if (topBtn) topBtn.style.opacity = enabled ? "1" : "0.6";
  if (bottomBtn) bottomBtn.style.opacity = enabled ? "1" : "0.6";
}

function showMissingEventState() {
  if (titleEl) titleEl.textContent = "Event not found";
  if (payloadEl) payloadEl.textContent = "Missing event parameter";

  setDescription(
    "This join link is missing an event ID. Please return to the event page and try again."
  );

  if (topBtn) topBtn.style.display = "none";
  if (bottomBtn) bottomBtn.style.display = "none";

  if (signInBtn) {
    signInBtn.style.display = "inline-flex";
    signInBtn.textContent = "Get Nearify on TestFlight";
    signInBtn.href = TESTFLIGHT_URL;
  }

  if (qrBox) qrBox.style.display = "none";
}

function renderInAppQr() {
  if (!eventId || typeof QRCode === "undefined" || !qrBox || !qrContainer) return;

  qrContainer.innerHTML = "";
  new QRCode(qrContainer, {
    text: deepLink,
    width: 200,
    height: 200
  });
  qrBox.style.display = "";
}

function initializePage() {
  if (!eventId) {
    console.warn("[Join] Missing event parameter");
    showMissingEventState();
    return false;
  }

  if (titleEl) {
    titleEl.textContent = `Open Nearify to join ${eventName}`;
  }

  if (payloadEl) {
    payloadEl.textContent = deepLink;
  }

  if (topBtn) topBtn.href = deepLink;
  if (bottomBtn) bottomBtn.href = deepLink;

  renderInAppQr();
  return true;
}

async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

async function ensureProfileFromSession() {
  const user = await getSessionUser();
  if (!user) throw new Error("No authenticated user");

  const name =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "Nearify User";

  const email = user.email || null;
  const avatarUrl = user.user_metadata?.avatar_url || null;

  const { data, error } = await supabase.rpc("ensure_profile", {
    p_name: name,
    p_email: email,
    p_avatar_url: avatarUrl
  });

  if (error) throw error;
  return data;
}

async function joinEventById(id) {
  const { data, error } = await supabase.rpc("join_event", {
    p_event_id: id
  });

  if (error) throw error;
  return data;
}

function tryOpenDeepLink(url) {
  console.log("[Join] Attempting to open app:", url);

  appOpened = false;

  setTimeout(() => {
    window.location.href = url;
  }, APP_OPEN_DELAY_MS);

  setTimeout(() => {
    if (!appOpened) {
      console.log("[Join] App did not open; staying on join page");
      setDescription(
        "If Nearify did not open automatically, tap “Open Nearify.” If you do not have the app yet, install it from TestFlight."
      );
      setButtonsEnabled(true);
    }
  }, APP_FALLBACK_DELAY_MS);
}

async function runJoinFlow({ autoOpenApp = true } = {}) {
  if (!eventId) throw new Error("Missing event ID");
  if (joinInProgress) {
    console.log("[Join] Join already in progress");
    return;
  }

  joinInProgress = true;
  setButtonsEnabled(false);

  try {
    const user = await getSessionUser();
    if (!user) {
      setDescription("Please sign in first.");
      setButtonsEnabled(true);
      return;
    }

    setDescription("Creating your profile...");
    const profile = await ensureProfileFromSession();
    console.log("[Join] Profile ensured:", profile);

    setDescription("Joining event...");
    const attendee = await joinEventById(eventId);
    console.log("[Join] Event joined:", attendee);

    if (autoOpenApp) {
      setDescription("Opening Nearify...");
      tryOpenDeepLink(deepLink);
    } else {
      setDescription(`Signed in as ${user.email}. Tap Open Nearify to continue into ${eventName}.`);
      setButtonsEnabled(true);
    }
  } catch (err) {
    console.error("[Join] Join flow failed:", err);
    setDescription(err?.message || "Could not join event.");
    setButtonsEnabled(true);
  } finally {
    joinInProgress = false;
  }
}

async function openNearifyFlow(e) {
  e.preventDefault();
  await runJoinFlow({ autoOpenApp: true });
}

async function refreshAuthState() {
  try {
    const user = await getSessionUser();

    if (user) {
      console.log("[Join] Signed in as:", user.email);
      setDescription(
        `Signed in as ${user.email}. Preparing your event access...`
      );
      if (signInBtn) signInBtn.style.display = "none";
      return true;
    }

    console.log("[Join] No active session");
    setDescription("Sign in first, then Nearify will join you to the event automatically.");
    if (signInBtn) {
      signInBtn.style.display = "inline-flex";
      signInBtn.href = currentJoinUrl;
      signInBtn.textContent = "Sign in to continue";
    }
    return false;
  } catch (error) {
    console.error("[Join] getSession error:", error);
    setDescription("Error checking sign-in state.");
    return false;
  }
}

async function signInWithGoogle(e) {
  e.preventDefault();

  try {
    const redirectTo = window.location.href;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });

    if (error) throw error;
  } catch (err) {
    console.error("[Join] Sign-in error:", err);
    setDescription(`Sign-in failed: ${err?.message || err}`);
  }
}

async function autoJoinIfSignedIn() {
  if (autoJoinAttempted || !eventId) return;
  autoJoinAttempted = true;

  const signedIn = await refreshAuthState();
  if (!signedIn) return;

  try {
    console.log("[Join] Auto-joining signed-in user...");
    await runJoinFlow({ autoOpenApp: true });
  } catch (err) {
    console.error("[Join] Auto-join failed:", err);
  }
}

if (initializePage()) {
  signInBtn?.addEventListener("click", signInWithGoogle);
  topBtn?.addEventListener("click", openNearifyFlow);
  bottomBtn?.addEventListener("click", openNearifyFlow);

  await autoJoinIfSignedIn();
}
