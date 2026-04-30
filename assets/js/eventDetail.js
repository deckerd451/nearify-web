import { supabase } from "./supabaseClient.js";
import { setCurrentEventId } from "./appState.js";
import { fetchIntelligence, fetchEventMeta, renderIntelligenceInto } from "./intelligence.js";
import {
  buildPersonalConnectUrl,
  getMyProfileId,
  renderPersonalConnectQr
} from "./personalConnect.js";
import { trackPageView, wireAppCtaTracking } from "./analytics.js";
import { patchAppStoreLinks } from "./config.js";
import { escapeHtml } from "./utils.js";

const JOIN_BASE = "https://nearify.org/join/";
const INTENT_STORAGE_KEY = "intent_primary";
const ATTENDEE_AUTH_KEY = "nearify_attendee_auth_return";
const ATTENDEE_JOIN_KEY = "nearify_attendee_join_pending";
const INTENT_OPTIONS = [
  "meet_people",
  "find_cofounder",
  "hire",
  "explore_ideas",
  "demo",
];

let currentEvent = null;
let currentUser = null;
let selectedIntent = null;

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric"
  });
}

function getDeepLink(eventId) {
  return `beacon://event/${encodeURIComponent(eventId)}`;
}

function parseStoredJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeIntentLocal(intent) {
  if (!intent) return;
  try {
    localStorage.setItem(INTENT_STORAGE_KEY, intent);
  } catch (_) {}
}

async function fetchEvent() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  const id = params.get("id");

  if (!slug && !id) return null;

  let query = supabase
    .from("events")
    .select("id, name, slug, location, starts_at, description")
    .is("deleted_at", null);

  query = slug ? query.eq("slug", slug) : query.eq("id", id);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user ?? null;
}

async function fetchProfileIntent(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("intent_primary")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return data?.intent_primary || null;
}

async function saveProfileIntent(userId, intent) {
  if (!userId || !intent) return false;

  const { error } = await supabase
    .from("profiles")
    .update({ intent_primary: intent })
    .eq("user_id", userId);

  if (error) {
    console.warn("[EventDetail] could not save intent_primary", error);
    return false;
  }
  return true;
}

function updateIntentUI() {
  const chips = document.querySelectorAll("[data-intent]");
  chips.forEach((chip) => {
    const isActive = chip.dataset.intent === selectedIntent;
    chip.classList.toggle("active", isActive);
    chip.setAttribute("aria-pressed", String(isActive));
  });
}

function setIntentStatus(message = "") {
  const status = document.getElementById("eventIntentStatus");
  if (!status) return;
  status.textContent = message;
}

async function persistIntent(intent) {
  if (!INTENT_OPTIONS.includes(intent)) return;
  selectedIntent = intent;
  updateIntentUI();
  storeIntentLocal(intent);
  setIntentStatus("Saving…");

  if (!currentUser?.id) {
    setIntentStatus("Intent saved for this session.");
    return;
  }

  const ok = await saveProfileIntent(currentUser.id, intent);
  if (ok) {
    setIntentStatus("Saved to your profile.");
  } else {
    setIntentStatus("Saved locally — sync will complete when the app opens.");
  }
  setTimeout(() => setIntentStatus(""), 3000);
}

function renderMetaGrid(event, isPast) {
  const grid = document.getElementById("eventMetaGrid");
  if (!grid) return;

  const cards = [];
  if (event.location) cards.push({ label: "Location", value: event.location });
  if (event.starts_at) cards.push({ label: "Date", value: formatDate(event.starts_at) });
  if (!isPast) cards.push({ label: "Experience", value: "Live attendee discovery" });

  grid.innerHTML = cards.map((c) =>
    `<div class="event-meta-card">
      <div class="meta-label">${escapeHtml(c.label)}</div>
      <div class="meta-value">${escapeHtml(c.value)}</div>
    </div>`
  ).join("");
}

function renderEventDetailsSection(event) {
  const details = document.getElementById("eventDetailsSection");
  const title = document.getElementById("eventDetailsTitle");
  const date = document.getElementById("eventDetailsDate");
  const location = document.getElementById("eventDetailsLocation");
  const description = document.getElementById("eventDetailsDescription");
  if (!details) return;

  if (title) title.textContent = event.name || "";
  if (date) date.textContent = event.starts_at ? formatDate(event.starts_at) : "To be announced";
  if (location) location.textContent = event.location || "Location to be announced";
  if (description) {
    description.textContent = event.description || "Join this event in Nearify and open the app on site for live recommendations.";
  }

  details.style.display = "";
}

function showNotFound(message = "") {
  const skeleton = document.getElementById("eventSkeleton");
  const notFound = document.getElementById("eventNotFound");
  const sections = document.getElementById("eventSections");
  if (skeleton) skeleton.style.display = "none";
  if (sections) sections.style.display = "none";
  if (notFound) {
    if (message) {
      const msg = notFound.querySelector(".event-not-found-message");
      if (msg) msg.textContent = message;
    }
    notFound.style.display = "";
  }
}

function showJoinFallback() {
  const fallback = document.getElementById("eventAppFallback");
  if (fallback) fallback.style.display = "";
}

function hideJoinFallback() {
  const fallback = document.getElementById("eventAppFallback");
  if (fallback) fallback.style.display = "none";
}

function attemptDeepLink(deepLink) {
  if (!deepLink) return;

  hideJoinFallback();
  const start = Date.now();
  let hidden = false;

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hidden = true;
    }
  };

  document.addEventListener("visibilitychange", onVisibility, { once: true });
  window.location.href = deepLink;

  window.setTimeout(() => {
    const elapsed = Date.now() - start;
    if (!hidden && document.visibilityState === "visible" && elapsed >= 900) {
      showJoinFallback();
    }
  }, 950);
}

function beginJoinFlow(source = "join") {
  if (!currentEvent?.id) return;
  const deepLink = getDeepLink(currentEvent.id);

  try {
    localStorage.setItem(ATTENDEE_JOIN_KEY, JSON.stringify({
      eventId: currentEvent.id,
      source,
      intent: selectedIntent || null,
      startedAt: Date.now(),
    }));
  } catch (_) {}

  attemptDeepLink(deepLink);
}

async function beginAttendeeSignIn() {
  if (!currentEvent?.id) return;

  try {
    localStorage.setItem(ATTENDEE_AUTH_KEY, JSON.stringify({
      eventId: currentEvent.id,
      returnTo: window.location.href,
      continueJoin: true,
      intent: selectedIntent || null,
      startedAt: Date.now(),
    }));
  } catch (_) {}

  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href },
  });
}

function wireIntentCapture() {
  const section = document.getElementById("eventIntentSection");
  if (!section) return;

  section.style.display = "";
  const chips = section.querySelectorAll("[data-intent]");
  chips.forEach((chip) => {
    chip.addEventListener("click", async () => {
      const intent = chip.dataset.intent;
      if (!intent) return;
      await persistIntent(intent);
    });
  });
}

function wireJoinActions() {
  const joinBtn = document.getElementById("eventJoinBtn");
  const continueBtn = document.getElementById("eventContinueWithoutSignInBtn");
  const signInBtn = document.getElementById("eventAttendeeSignInBtn");
  const retryBtn = document.getElementById("eventOpenAppRetryBtn");

  if (joinBtn) {
    joinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      beginJoinFlow("join_button");
    });
  }

  if (continueBtn) {
    continueBtn.addEventListener("click", (e) => {
      e.preventDefault();
      beginJoinFlow("continue_without_sign_in");
    });
  }

  if (signInBtn) {
    signInBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      signInBtn.disabled = true;
      signInBtn.classList.add("loading");
      try {
        await beginAttendeeSignIn();
      } catch (error) {
        console.error("[EventDetail] attendee sign-in failed", error);
        signInBtn.disabled = false;
        signInBtn.classList.remove("loading");
      }
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      beginJoinFlow("retry_open_app");
    });
  }
}

function updateAuthPositioning() {
  const prompt = document.getElementById("eventAttendeeAuthPrompt");
  const signedInNote = document.getElementById("eventSignedInNote");
  if (!prompt || !signedInNote) return;

  if (currentUser) {
    prompt.style.display = "none";
    signedInNote.style.display = "";
  } else {
    prompt.style.display = "";
    signedInNote.style.display = "none";
  }
}

async function hydrateIntentFromStorage() {
  const localIntent = localStorage.getItem(INTENT_STORAGE_KEY);

  if (!currentUser?.id) {
    selectedIntent = INTENT_OPTIONS.includes(localIntent) ? localIntent : null;
    updateIntentUI();
    return;
  }

  const profileIntent = await fetchProfileIntent(currentUser.id);
  const resolved = INTENT_OPTIONS.includes(profileIntent)
    ? profileIntent
    : INTENT_OPTIONS.includes(localIntent)
      ? localIntent
      : null;

  if (resolved) {
    selectedIntent = resolved;
    updateIntentUI();
  }
}

async function maybeContinueAfterAuth() {
  const authState = parseStoredJson(ATTENDEE_AUTH_KEY);
  if (!authState || !currentUser || !currentEvent?.id) return;
  if (authState.eventId !== currentEvent.id || authState.continueJoin !== true) return;

  if (authState.intent && INTENT_OPTIONS.includes(authState.intent)) {
    await persistIntent(authState.intent);
  }

  localStorage.removeItem(ATTENDEE_AUTH_KEY);
  beginJoinFlow("after_attendee_sign_in");
}

async function loadIntelligence(event) {
  const intelSection = document.getElementById("eventIntelSection");
  const signInGate = document.getElementById("eventIntelSignInGate");
  const signInDesc = document.getElementById("eventIntelSignInDesc");
  const intelContainer = document.getElementById("eventIntelContainer");

  if (!intelSection) return;
  intelSection.style.display = "";

  if (!currentUser) {
    if (signInDesc) {
      signInDesc.textContent =
        `Sign in to see who you connected with at ${event.name} and review your post-event report.`;
    }
    if (signInGate) signInGate.style.display = "";

    const signInBtn = document.getElementById("eventIntelSignInBtn");
    if (signInBtn) {
      signInBtn.addEventListener("click", async () => {
        signInBtn.disabled = true;
        signInBtn.classList.add("loading");
        try {
          await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.href }
          });
        } catch (err) {
          console.error("[EventDetail] sign in error:", err);
          signInBtn.disabled = false;
          signInBtn.classList.remove("loading");
        }
      });
    }
    return;
  }

  if (!intelContainer) return;

  try {
    const [{ data, fallbackDecision }, eventMeta] = await Promise.all([
      fetchIntelligence(event.id),
      fetchEventMeta(event.id),
    ]);
    renderIntelligenceInto(intelContainer, data, eventMeta, fallbackDecision);
  } catch (err) {
    console.error("[EventDetail] intelligence load error:", err);
    intelContainer.innerHTML =
      '<p style="color:#f87171; text-align:center; padding:24px 0;">Could not load your report. Please refresh.</p>';
    intelContainer.style.display = "";
  }
}

async function renderPersonalConnectSection(eventId) {
  const section = document.getElementById("personalConnectSection");
  const urlEl = document.getElementById("personalConnectUrl");
  const qrBox = document.getElementById("personalConnectQrBox");
  const qrEl = document.getElementById("personalConnectQr");

  if (!section || !urlEl || !qrBox || !qrEl || !eventId) return;

  try {
    const profileId = await getMyProfileId();
    if (!profileId) return;

    const url = buildPersonalConnectUrl(eventId, profileId);
    if (!url) return;

    urlEl.textContent = url;
    section.style.display = "";
    qrBox.style.display = "";
    renderPersonalConnectQr(qrEl, url);
  } catch (error) {
    console.error("[PersonalConnect] Failed to render", error);
  }
}

function renderQr(eventId, eventName) {
  if (typeof QRCode === "undefined") return;
  const el = document.getElementById("eventQrCode");
  if (!el) return;
  el.innerHTML = "";
  new QRCode(el, {
    text: JOIN_BASE + "?event=" + encodeURIComponent(eventId) +
          "&name=" + encodeURIComponent(eventName),
    width: 220, height: 220
  });
}

async function populatePage(event) {
  const isPast = !!(event.starts_at && new Date(event.starts_at) < new Date());

  document.title = `${event.name} | Nearify`;
  const setMeta = (sel, val) => {
    const el = document.querySelector(sel);
    if (el) el.setAttribute("content", val);
  };
  setMeta('meta[property="og:title"]', `${event.name} | Nearify`);
  setMeta('meta[name="twitter:title"]', `${event.name} | Nearify`);
  setMeta('meta[property="og:description"]', event.description || `Discover and connect with attendees at ${event.name} in real time.`);
  setMeta('meta[name="twitter:description"]', event.description || `Discover and connect with attendees at ${event.name} in real time.`);
  setMeta('meta[property="og:url"]', `https://nearify.org/events/event.html?slug=${encodeURIComponent(event.slug || event.id)}`);

  const kickerEl = document.getElementById("eventKicker");
  const titleEl = document.getElementById("eventTitle");
  const subheadEl = document.getElementById("eventSubhead");

  if (kickerEl) kickerEl.textContent = isPast ? "Past Event" : "Nearify Event";
  if (titleEl) titleEl.textContent = event.name;
  if (subheadEl) {
    subheadEl.textContent = event.description ||
      (isPast
        ? "This event has ended."
        : "Set what you want from this event, join, and open Nearify for live recommendations in the room.");
  }

  renderMetaGrid(event, isPast);
  setCurrentEventId(event.id);

  if (isPast) {
    const heroActions = document.getElementById("eventHeroActions");
    const sidePanel = document.getElementById("eventSidePanel");
    const sections = document.getElementById("eventSections");
    const detailsSection = document.getElementById("eventDetailsSection");
    const intentSection = document.getElementById("eventIntentSection");
    const authPrompt = document.getElementById("eventAttendeeAuthPrompt");
    const signedInNote = document.getElementById("eventSignedInNote");
    const fallback = document.getElementById("eventAppFallback");

    if (heroActions) heroActions.style.display = "none";
    if (sidePanel) sidePanel.style.display = "none";
    if (sections) sections.style.display = "none";
    if (detailsSection) detailsSection.style.display = "none";
    if (intentSection) intentSection.style.display = "none";
    if (authPrompt) authPrompt.style.display = "none";
    if (signedInNote) signedInNote.style.display = "none";
    if (fallback) fallback.style.display = "none";

    const heroEl = document.querySelector(".event-hero");
    if (heroEl) heroEl.classList.add("event-hero--past");

    await loadIntelligence(event);
  } else {
    renderQr(event.id, event.name);
    renderEventDetailsSection(event);

    const sections = document.getElementById("eventSections");
    if (sections) sections.style.display = "";

    wireIntentCapture();
    wireJoinActions();
    updateAuthPositioning();
    await hydrateIntentFromStorage();
    await maybeContinueAfterAuth();
  }

  const skeleton = document.getElementById("eventSkeleton");
  const heroCopy = document.getElementById("eventHeroCopy");
  if (skeleton) skeleton.style.display = "none";
  if (heroCopy) heroCopy.style.display = "";
}

async function init() {
  try {
    currentEvent = await fetchEvent();
    if (!currentEvent) {
      showNotFound();
      return;
    }

    currentUser = await fetchCurrentUser();
    await populatePage(currentEvent);
    await renderPersonalConnectSection(currentEvent.id);

    patchAppStoreLinks();
    trackPageView({ eventId: currentEvent.id });
    wireAppCtaTracking();
  } catch (err) {
    console.error("[EventDetail] load error:", err);
    showNotFound("Something went wrong loading this event. Please try again.");
  }
}

init();
