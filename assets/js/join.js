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

// Existing DOM refs
const titleEl = document.getElementById("joinTitle");
const payloadEl = document.getElementById("payloadText");
const topBtn = document.getElementById("openNearifyBtn");
const bottomBtn = document.getElementById("openNearifyBtnBottom");
const signInBtn = document.getElementById("signInBtn");
const descEl = document.getElementById("joinDescription");
const qrBox = document.getElementById("joinQrBox");
const qrContainer = document.getElementById("joinQrCode");

// Intent DOM refs
const intentStep = document.getElementById("intentStep");
const intentChips = document.querySelectorAll(".intent-chip");
const skipIntentBtn = document.getElementById("skipIntentBtn");
const intentStatus = document.getElementById("intentStatus");

// Intelligence DOM refs
const intelligencePanel = document.getElementById("intelligencePanel");
const intelFollowUp = document.getElementById("intelFollowUp");
const intelMissed = document.getElementById("intelMissed");
const intelStrong = document.getElementById("intelStrong");
const intelFollowUpCards = document.getElementById("intelFollowUpCards");
const intelMissedCards = document.getElementById("intelMissedCards");
const intelStrongCards = document.getElementById("intelStrongCards");
const intelEmpty = document.getElementById("intelEmpty");

const deepLink = eventId ? `beacon://event/${eventId}` : "#";
const currentJoinUrl = window.location.href;

// ============================================================
// CENTRAL STATE — single source of truth, persisted per session
// ============================================================
const SESSION_KEY = `nearify_join_${eventId}`;

const joinState = {
  initialized: false,
  profileEnsured: false,
  eventJoined: false,
  intentShown: false,
  intentSaved: false,
  appLaunchAttempted: false
};

// Restore from sessionStorage on reload
try {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) Object.assign(joinState, JSON.parse(saved));
} catch (_) { /* ignore parse errors */ }

function persistState() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(joinState));
  } catch (_) { /* quota errors etc */ }
}

let appOpened = false;
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
  if (joinState.profileEnsured) {
    console.log("[Join] Profile already ensured — skipping");
    return null;
  }

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

  joinState.profileEnsured = true;
  persistState();
  console.log("[Join] Profile ensured (once)");
  return data;
}

async function joinEventById(id) {
  if (joinState.eventJoined) {
    console.log("[Join] Event already joined — skipping");
    return null;
  }

  const { data, error } = await supabase.rpc("join_event", {
    p_event_id: id
  });

  if (error) throw error;

  joinState.eventJoined = true;
  persistState();
  console.log("[Join] Event joined (once)");
  return data;
}

function tryOpenDeepLink(url) {
  if (joinState.appLaunchAttempted) {
    console.log("[Join] App launch already attempted — skipping");
    return;
  }

  joinState.appLaunchAttempted = true;
  persistState();
  console.log("[Join] Attempting app launch (once):", url);

  appOpened = false;

  setTimeout(() => {
    window.location.href = url;
  }, APP_OPEN_DELAY_MS);

  setTimeout(() => {
    if (!appOpened) {
      console.log("[Join] App did not open; staying on join page");
      setDescription(
        "If Nearify did not open automatically, tap \u201cOpen Nearify.\u201d If you do not have the app yet, install it from TestFlight."
      );
      setButtonsEnabled(true);
    }
  }, APP_FALLBACK_DELAY_MS);
}

// ============================================================
// INTENT CAPTURE (Phase 2)
// ============================================================

function showIntentStep() {
  if (joinState.intentShown) {
    console.log("[Join] Intent step already shown — skipping");
    return;
  }

  if (intentStep) {
    intentStep.style.display = "";
    intentStep.scrollIntoView({ behavior: "smooth", block: "start" });
    joinState.intentShown = true;
    persistState();
    console.log("[Join] Intent step shown (once)");
  }
}

function hideIntentStep() {
  if (intentStep) intentStep.style.display = "none";
}

async function submitIntent(intentValue) {
  if (!eventId) return;
  if (joinState.intentSaved) {
    console.log("[Join] Intent already saved — skipping");
    return;
  }

  try {
    if (intentStatus) intentStatus.textContent = "Saving...";

    // Disable all chips immediately to prevent double-clicks
    intentChips.forEach((c) => { c.disabled = true; c.style.pointerEvents = "none"; });
    if (skipIntentBtn) { skipIntentBtn.disabled = true; skipIntentBtn.style.pointerEvents = "none"; }

    const { data, error } = await supabase.rpc("update_attendee_intent", {
      p_event_id: eventId,
      p_intent_primary: intentValue
    });

    if (error) throw error;

    joinState.intentSaved = true;
    persistState();
    console.log("[Join] Intent saved (once):", data);
    if (intentStatus) intentStatus.textContent = "Got it — enjoy the event.";

    // Fade out intent step after brief confirmation
    setTimeout(() => {
      hideIntentStep();
      loadIntelligence();
    }, 1200);
  } catch (err) {
    console.error("[Join] Intent save failed:", err);
    if (intentStatus) intentStatus.textContent = "Could not save — you can set this later.";
    // Re-enable on failure so user can retry
    intentChips.forEach((c) => { c.disabled = false; c.style.pointerEvents = "auto"; });
    if (skipIntentBtn) { skipIntentBtn.disabled = false; skipIntentBtn.style.pointerEvents = "auto"; }
  }
}

function initIntentListeners() {
  intentChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      // Visual feedback
      intentChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      submitIntent(chip.dataset.intent);
    });
  });

  if (skipIntentBtn) {
    skipIntentBtn.addEventListener("click", () => {
      console.log("[Join] Intent skipped");
      hideIntentStep();
      loadIntelligence();
    });
  }
}

// ============================================================
// INTELLIGENCE DISPLAY (Phase 5)
// ============================================================

function renderIntelCard(item) {
  const card = document.createElement("div");
  card.className = "intel-card";

  const avatar = item.target_avatar
    ? `<img class="intel-avatar" src="${item.target_avatar}" alt="" />`
    : `<div class="intel-avatar intel-avatar-placeholder"></div>`;

  card.innerHTML = `
    ${avatar}
    <div class="intel-card-body">
      <div class="intel-card-name">${item.target_name || "Attendee"}</div>
      <div class="intel-card-reason">${item.reason || ""}</div>
      <div class="intel-card-score">Score: ${Math.round(item.score)}</div>
    </div>
  `;
  return card;
}

async function loadIntelligence() {
  if (!eventId || !intelligencePanel) return;

  try {
    const user = await getSessionUser();
    if (!user) return;

    const { data, error } = await supabase.rpc("get_my_intelligence", {
      p_event_id: eventId
    });

    if (error) {
      console.error("[Join] Intelligence load error:", error);
      return;
    }

    if (!data || data.length === 0) {
      intelligencePanel.style.display = "";
      if (intelEmpty) intelEmpty.style.display = "";
      return;
    }

    console.log("[Join] Intelligence loaded:", data.length, "items");

    const recommended = data.filter((d) => d.type === "recommended");
    const missed = data.filter((d) => d.type === "missed");
    const followUp = data.filter((d) => d.type === "follow_up");

    if (recommended.length && intelStrong && intelStrongCards) {
      intelStrong.style.display = "";
      recommended.forEach((item) => intelStrongCards.appendChild(renderIntelCard(item)));
    }

    if (missed.length && intelMissed && intelMissedCards) {
      intelMissed.style.display = "";
      missed.forEach((item) => intelMissedCards.appendChild(renderIntelCard(item)));
    }

    if (followUp.length && intelFollowUp && intelFollowUpCards) {
      intelFollowUp.style.display = "";
      followUp.forEach((item) => intelFollowUpCards.appendChild(renderIntelCard(item)));
    }

    intelligencePanel.style.display = "";
  } catch (err) {
    console.error("[Join] Intelligence load failed:", err);
  }
}

// ============================================================
// JOIN FLOW (existing, enhanced)
// ============================================================

async function runJoinFlow({ autoOpenApp = true } = {}) {
  if (!eventId) throw new Error("Missing event ID");
  if (joinInProgress) {
    console.log("[Join] Join flow already in progress — skipping reentry");
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
    await ensureProfileFromSession();

    setDescription("Joining event...");
    await joinEventById(eventId);

    // Show intent capture after successful join
    showIntentStep();

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
  if (joinState.initialized || !eventId) return;
  joinState.initialized = true;
  persistState();

  const signedIn = await refreshAuthState();
  if (!signedIn) return;

  try {
    console.log("[Join] Auto-joining signed-in user...");
    await runJoinFlow({ autoOpenApp: true });
  } catch (err) {
    console.error("[Join] Auto-join failed:", err);
  }
}

// ============================================================
// INIT
// ============================================================

if (initializePage()) {
  initIntentListeners();

  signInBtn?.addEventListener("click", signInWithGoogle);
  topBtn?.addEventListener("click", openNearifyFlow);
  bottomBtn?.addEventListener("click", openNearifyFlow);

  await autoJoinIfSignedIn();

  // If user is returning after the event, load intelligence
  const user = await getSessionUser();
  if (user) {
    loadIntelligence();
  }
}
