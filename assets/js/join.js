import { supabase } from "./supabaseClient.js";
import { renderIntelCard, fetchIntelligence } from "./intelligence.js";
import { setCurrentEventId } from "./appState.js";

console.log("[Join] join.js loaded");

const TESTFLIGHT_URL = "https://testflight.apple.com/join/ZayvEbAy";

const params = new URLSearchParams(window.location.search);
const eventId = params.get("event");
const eventName = params.get("name") || "this event";

// Persist event ID so other pages (homepage, app) can access it
if (eventId) setCurrentEventId(eventId);

// DOM refs
const titleEl    = document.getElementById("joinTitle");
const payloadEl  = document.getElementById("payloadText");
const descEl     = document.getElementById("joinDescription");
const qrBox      = document.getElementById("joinQrBox");
const qrContainer = document.getElementById("joinQrCode");

// Intent DOM refs
const intentStep   = document.getElementById("intentStep");
const intentChips  = document.querySelectorAll(".intent-chip");
const skipIntentBtn = document.getElementById("skipIntentBtn");
const intentStatus = document.getElementById("intentStatus");

// Intelligence DOM refs
const intelligencePanel = document.getElementById("intelligencePanel");
const intelFollowUp     = document.getElementById("intelFollowUp");
const intelMissed       = document.getElementById("intelMissed");
const intelStrong       = document.getElementById("intelStrong");
const intelFollowUpCards = document.getElementById("intelFollowUpCards");
const intelMissedCards   = document.getElementById("intelMissedCards");
const intelStrongCards   = document.getElementById("intelStrongCards");
const intelEmpty         = document.getElementById("intelEmpty");

const deepLink = eventId ? `beacon://event/${eventId}` : "#";

// ============================================================
// SESSION STATE — persisted per event, used for signed-in flows
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

try {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) Object.assign(joinState, JSON.parse(saved));
} catch (_) { /* ignore */ }

function persistState() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(joinState)); } catch (_) {}
}

let appOpened = false;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    appOpened = true;
    console.log("[Join] App switch detected");
  }
});

// ============================================================
// PAGE INITIALIZATION — works for ALL visitors, no auth needed
// ============================================================

function showMissingEventState() {
  if (titleEl) titleEl.textContent = "Event not found";
  if (payloadEl) payloadEl.textContent = "Missing event parameter";
  if (descEl) descEl.textContent =
    "This join link is missing an event ID. Return to the event page and try again.";
  if (qrBox) qrBox.style.display = "none";
}

function renderInAppQr() {
  if (!eventId || typeof QRCode === "undefined" || !qrBox || !qrContainer) return;
  qrContainer.innerHTML = "";
  new QRCode(qrContainer, { text: deepLink, width: 200, height: 200 });
  qrBox.style.display = "";
}

function initializePage() {
  if (!eventId) {
    console.warn("[Join] Missing event parameter");
    showMissingEventState();
    return false;
  }

  if (titleEl) titleEl.textContent = `Join ${eventName}`;
  if (payloadEl) payloadEl.textContent = deepLink;

  renderInAppQr();
  silentDeepLinkAttempt();
  fetchAndDisplayEventMetadata();

  return true;
}

async function fetchAndDisplayEventMetadata() {
  const metaEl = document.getElementById("joinEventMeta");
  const kickerEl = document.getElementById("joinKicker");
  if (!metaEl || !eventId) return;

  try {
    const { data, error } = await supabase
      .from("events")
      .select("name, location, starts_at")
      .eq("id", eventId)
      .maybeSingle();

    if (error || !data) return;

    const chips = [];

    if (data.location) {
      chips.push(`<span class="join-meta-chip"><span class="join-meta-chip-icon">📍</span>${escapeHtml(data.location)}</span>`);
    }

    if (data.starts_at) {
      const dateStr = new Date(data.starts_at).toLocaleDateString(undefined, {
        weekday: "short", month: "short", day: "numeric", year: "numeric"
      });
      chips.push(`<span class="join-meta-chip"><span class="join-meta-chip-icon">📅</span>${dateStr}</span>`);
    }

    if (chips.length) {
      metaEl.innerHTML = chips.join("");
      metaEl.style.display = "";
    }

    // Update the page title if name differs from URL param
    if (data.name && titleEl) {
      titleEl.textContent = `Join ${data.name}`;
      document.title = `${data.name} | Nearify`;
    }

    if (kickerEl && data.name) {
      kickerEl.textContent = "You're joining";
    }
  } catch (err) {
    console.warn("[Join] Could not fetch event metadata:", err.message);
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// SILENT DEEP LINK — attempt once, don't rely on it
// ============================================================

function silentDeepLinkAttempt() {
  if (joinState.appLaunchAttempted) return;

  joinState.appLaunchAttempted = true;
  persistState();

  console.log("[Join] Silent deep link attempt:", deepLink);

  // Use a hidden iframe to avoid navigating away from the page
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = deepLink;
  document.body.appendChild(iframe);

  // Clean up after a short delay
  setTimeout(() => {
    try { document.body.removeChild(iframe); } catch (_) {}
  }, 3000);
}

// ============================================================
// AUTH HELPERS — used only for optional signed-in enhancements
// ============================================================

async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

async function ensureProfileFromSession() {
  if (joinState.profileEnsured) return null;
  const user = await getSessionUser();
  if (!user) throw new Error("No authenticated user");

  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Nearify User";
  const { data, error } = await supabase.rpc("ensure_profile", {
    p_name: name,
    p_email: user.email || null,
    p_avatar_url: user.user_metadata?.avatar_url || null
  });
  if (error) throw error;

  joinState.profileEnsured = true;
  persistState();
  console.log("[Join] Profile ensured");
  return data;
}

async function joinEventById(id) {
  if (joinState.eventJoined) return null;
  const { data, error } = await supabase.rpc("join_event", { p_event_id: id });
  if (error) throw error;

  joinState.eventJoined = true;
  persistState();
  console.log("[Join] Event joined");
  return data;
}

// ============================================================
// INTENT CAPTURE — only for signed-in users
// ============================================================

function showIntentStep() {
  if (joinState.intentShown) return;
  if (intentStep) {
    intentStep.style.display = "";
    intentStep.scrollIntoView({ behavior: "smooth", block: "start" });
    joinState.intentShown = true;
    persistState();
  }
}

function hideIntentStep() {
  if (intentStep) intentStep.style.display = "none";
}

async function submitIntent(intentValue) {
  if (!eventId || joinState.intentSaved) return;

  try {
    if (intentStatus) intentStatus.textContent = "Saving...";
    intentChips.forEach((c) => { c.disabled = true; c.style.pointerEvents = "none"; });
    if (skipIntentBtn) { skipIntentBtn.disabled = true; skipIntentBtn.style.pointerEvents = "none"; }

    const { data, error } = await supabase.rpc("update_attendee_intent", {
      p_event_id: eventId,
      p_intent_primary: intentValue
    });
    if (error) throw error;

    joinState.intentSaved = true;
    persistState();
    if (intentStatus) intentStatus.textContent = "Got it — enjoy the event.";

    setTimeout(() => { hideIntentStep(); loadIntelligence(); }, 1200);
  } catch (err) {
    console.error("[Join] Intent save failed:", err);
    if (intentStatus) intentStatus.textContent = "Could not save — you can set this later.";
    intentChips.forEach((c) => { c.disabled = false; c.style.pointerEvents = "auto"; });
    if (skipIntentBtn) { skipIntentBtn.disabled = false; skipIntentBtn.style.pointerEvents = "auto"; }
  }
}

function initIntentListeners() {
  intentChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      intentChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      submitIntent(chip.dataset.intent);
    });
  });

  if (skipIntentBtn) {
    skipIntentBtn.addEventListener("click", () => {
      hideIntentStep();
      loadIntelligence();
    });
  }
}

// ============================================================
// INTELLIGENCE — only for signed-in users
// ============================================================

// renderIntelCard is imported from intelligence.js

async function loadIntelligence() {
  if (!eventId || !intelligencePanel) return;

  try {
    const data = await fetchIntelligence(eventId);

    if (!data || data.length === 0) {
      intelligencePanel.style.display = "";
      if (intelEmpty) intelEmpty.style.display = "";
      return;
    }

    console.log("[Join] Intelligence loaded:", data.length, "items");

    const recommended = data.filter((d) => d.type === "recommended");
    const missed      = data.filter((d) => d.type === "missed");
    const followUp    = data.filter((d) => d.type === "follow_up");

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
// SIGNED-IN ENHANCEMENT — runs silently if user happens to be
// authenticated, but never blocks the public page
// ============================================================

async function enhanceForSignedInUser() {
  try {
    const user = await getSessionUser();
    if (!user) {
      console.log("[Join] No session — page stays in public attendee mode");
      return;
    }

    console.log("[Join] Signed in as:", user.email);

    // Silently ensure profile + join event in background
    await ensureProfileFromSession();
    await joinEventById(eventId);

    // Show intent capture if not already done
    showIntentStep();

    // Load intelligence if available
    loadIntelligence();
  } catch (err) {
    // Non-fatal — the page still works without auth
    console.warn("[Join] Signed-in enhancement failed (non-blocking):", err.message);
  }
}

// ============================================================
// INIT — page works immediately for everyone
// ============================================================

if (initializePage()) {
  initIntentListeners();

  // If user is already signed in, enhance the experience silently
  enhanceForSignedInUser();
}
