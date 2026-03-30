import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("join.js module loaded");

const supabaseUrl = "https://unndeygygkgodmmdnlup.supabase.co";
const supabaseKey = "sb_publishable_G0KAfCFTovYCWDeEEKWBfg_8UpPHWWZ";

const supabase = createClient(supabaseUrl, supabaseKey);
window.supabase = supabase;

console.log("Supabase attached to window:", window.supabase);

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
  const method = enabled ? "removeAttribute" : "setAttribute";
  if (topBtn) topBtn[method]("aria-disabled", "true");
  if (bottomBtn) bottomBtn[method]("aria-disabled", "true");
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
    signInBtn.href = "https://testflight.apple.com/join/ZayvEbAy";
  }

  if (qrBox) qrBox.style.display = "none";
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

  if (typeof QRCode !== "undefined" && qrBox && qrContainer) {
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
      text: deepLink,
      width: 200,
      height: 200
    });
    qrBox.style.display = "";
  }

  return true;
}

async function ensureProfileFromSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const user = sessionData.session?.user;
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
  window.location.href = url;

  setTimeout(() => {
    if (!appOpened) {
      console.log("[Join] App did not open; staying on join page");
      setDescription(
        "If Nearify did not open, tap “Open Nearify” again. If you do not have the app yet, install it from TestFlight."
      );
    }
  }, 2000);
}

async function openNearifyFlow(e) {
  e.preventDefault();

  try {
    if (!eventId) throw new Error("Missing event ID");

    setButtonsEnabled(false);

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    const session = sessionData.session;
    if (!session?.user) {
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

    setDescription("Opening Nearify...");
    tryOpenDeepLink(deepLink);
  } catch (err) {
    console.error("[Join] Open Nearify flow failed:", err);
    setDescription(err?.message || "Could not join event.");
    setButtonsEnabled(true);
  }
}

async function refreshAuthState() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("[Join] getSession error:", error);
    setDescription("Error checking sign-in state.");
    return;
  }

  const session = data.session;

  if (session?.user) {
    console.log("[Join] Signed in as:", session.user.email);
    setDescription(
      `Signed in as ${session.user.email}. Tap Open Nearify to join the event.`
    );
    if (signInBtn) signInBtn.style.display = "none";
  } else {
    console.log("[Join] No active session");
    setDescription("Sign in first, then open Nearify to join the event.");
    if (signInBtn) {
      signInBtn.style.display = "inline-flex";
      signInBtn.href = currentJoinUrl;
      signInBtn.textContent = "Sign in to continue";
    }
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

if (initializePage()) {
  signInBtn?.addEventListener("click", signInWithGoogle);
  topBtn?.addEventListener("click", openNearifyFlow);
  bottomBtn?.addEventListener("click", openNearifyFlow);
  await refreshAuthState();
}
