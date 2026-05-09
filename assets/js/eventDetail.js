// eslint-disable-next-line no-console
console.log("[EVENT-DETAIL-BOOTED]");
window.__EVENT_DETAIL_BOOTED__ = true;

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
import { logger } from "./logger.js";

const INTENT_STORAGE_KEY = "intent_primary";
const ATTENDEE_AUTH_KEY = "nearify_attendee_auth_return";
const ATTENDEE_JOIN_KEY = "nearify_attendee_join_pending";
const INTENT_OPTIONS = [
  "meet_people",
  "find_cofounder",
  "hire",
  "explore_ideas",
  "demo_something",
];

const INTENT_LABELS = {
  meet_people:    "Meet people",
  find_cofounder: "Find a cofounder",
  hire:           "Hire",
  explore_ideas:  "Explore ideas",
  demo_something: "Demo something",
};

let currentEvent = null;
let currentUser = null;
let selectedIntent = null;

function formatDateTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
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

async function fetchEvent() {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  const rawId = params.get("id");
  const id = rawId && UUID_RE.test(rawId) ? rawId : null;

  if (!slug && !id) return null;

  let query = supabase
    .from("events")
    .select("*")
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

async function fetchAttendeeIntent(userId, eventId) {
  if (!userId || !eventId) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.id) return null;
  const { data } = await supabase
    .from("event_attendees")
    .select("intent_primary")
    .eq("event_id", eventId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  return data?.intent_primary || null;
}

function updateIntentUI() {
  const chips = document.querySelectorAll("[data-intent]");
  chips.forEach((chip) => {
    const isActive = chip.dataset.intent === selectedIntent;
    chip.classList.toggle("active", isActive);
    chip.setAttribute("aria-pressed", String(isActive));
  });
}

function renderIntentReadOnly(intent) {
  const display  = document.getElementById("eventIntentDisplay");
  const valueEl  = document.getElementById("eventIntentDisplayValue");
  const picker   = document.getElementById("eventIntentPicker");
  const heading  = document.getElementById("eventIntentHeading");

  if (valueEl) valueEl.textContent = INTENT_LABELS[intent] || intent;
  if (display) display.style.display = "";
  if (picker)  picker.style.display  = "none";
  if (heading) heading.textContent   = "Your event goal";
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
  setIntentStatus("Saving…");

  if (!currentUser?.id || !currentEvent?.id) {
    try { localStorage.setItem(INTENT_STORAGE_KEY, intent); } catch (_) {}
    setIntentStatus("Your goal is saved for this session — open Nearify to keep it.");
    setTimeout(() => setIntentStatus(""), 4000);
    return;
  }

  const { error } = await supabase.rpc("update_attendee_intent", {
    p_event_id: currentEvent.id,
    p_intent_primary: intent,
  });

  if (error) {
    logger.warn("[EventDetail] update_attendee_intent failed", error);
    try { localStorage.setItem(INTENT_STORAGE_KEY, intent); } catch (_) {}
    setIntentStatus("Saved locally — sync will complete when you open the app.");
  } else {
    setIntentStatus("Saved — Nearify will use this in the app.");
  }
  setTimeout(() => setIntentStatus(""), 3000);
}

function renderMetaGrid(event, isPast) {
  const grid = document.getElementById("eventMetaGrid");
  if (!grid) return;

  const cards = [];
  if (event.location) cards.push({ label: "Location", value: event.location });
  if (event.starts_at) cards.push({ label: "Date & time", value: formatDateTime(event.starts_at) });
  if (!isPast) cards.push({ label: "Experience", value: "Live attendee discovery" });

  grid.innerHTML = cards.map((c) =>
    `<div class="event-meta-card">
      <div class="meta-label">${escapeHtml(c.label)}</div>
      <div class="meta-value">${escapeHtml(c.value)}</div>
    </div>`
  ).join("");
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
  const continueBtn = document.getElementById("eventContinueWithoutSignInBtn");
  const signInBtn = document.getElementById("eventAttendeeSignInBtn");
  const retryBtn = document.getElementById("eventOpenAppRetryBtn");

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
        logger.error("[EventDetail] attendee sign-in failed", error);
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

async function hydrateIntent() {
  if (!currentUser?.id) {
    // Ghost / unauthenticated: localStorage only, no RPC available
    const localIntent = localStorage.getItem(INTENT_STORAGE_KEY);
    selectedIntent = INTENT_OPTIONS.includes(localIntent) ? localIntent : null;
    updateIntentUI();
    return;
  }

  // Source of truth: event_attendees.intent_primary for this event
  const attendeeIntent = await fetchAttendeeIntent(currentUser.id, currentEvent?.id);
  if (attendeeIntent && INTENT_OPTIONS.includes(attendeeIntent)) {
    // Intent already set (from iOS or a previous web session) — show read-only
    selectedIntent = attendeeIntent;
    renderIntentReadOnly(attendeeIntent);
    return;
  }

  // Attendee exists but no intent set — show editable picker
  // Surface any localStorage pre-selection without persisting it
  const localIntent = localStorage.getItem(INTENT_STORAGE_KEY);
  if (localIntent && INTENT_OPTIONS.includes(localIntent)) {
    selectedIntent = localIntent;
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
          logger.error("[EventDetail] sign in error:", err);
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
    logger.error("[EventDetail] intelligence load error:", err);
    intelContainer.innerHTML =
      '<p style="color:#f87171; text-align:center; padding:24px 0;">Could not load your report. Please refresh.</p>';
    intelContainer.style.display = "";
  }
}

// ---------------------------------------------------------------------------
// Attendee discovery
// ---------------------------------------------------------------------------

function getInitials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatTagList(value, limit = 4) {
  if (!value) return "";
  const arr = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return arr.slice(0, limit).map((s) => String(s).trim()).filter(Boolean).join(" · ");
}

async function fetchEventAttendees(eventId) {
  const { data: attendeeRows, error: attendeeError } = await supabase
    .from("event_attendees")
    .select("profile_id, intent_primary")
    .eq("event_id", eventId);

  if (attendeeError || !attendeeRows?.length) return [];

  const profileIds = attendeeRows.map((r) => r.profile_id);
  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, avatar_url, interests, skills")
    .in("id", profileIds);

  if (profileError) {
    logger.error("[EventDetail] attendee discovery profiles error:", profileError);
    return [];
  }

  const profileMap = new Map((profileRows || []).map((p) => [p.id, p]));

  return attendeeRows.map((a) => {
    const profile = profileMap.get(a.profile_id);
    if (!profile) return null;
    return {
      profileId:  a.profile_id,
      name:       profile.name || "Attendee",
      avatarUrl:  profile.avatar_url || null,
      intent:     a.intent_primary || null,  // event_attendees is source of truth
      interests:  profile.interests || null,
      skills:     profile.skills || null,
    };
  }).filter(Boolean);
}

function buildAttendeeCard(attendee, showDetails) {
  const initials   = getInitials(attendee.name);
  const intentLabel = attendee.intent ? (INTENT_LABELS[attendee.intent] || attendee.intent) : null;
  const tagLine    = showDetails
    ? formatTagList(attendee.interests) || formatTagList(attendee.skills)
    : "";

  const card = document.createElement("div");
  card.className = "attendee-card";

  const avatarEl = document.createElement("div");
  avatarEl.className = "attendee-avatar";
  if (attendee.avatarUrl) {
    const img = document.createElement("img");
    img.className = "attendee-avatar-img";
    img.src = attendee.avatarUrl;
    img.alt = initials;
    img.loading = "lazy";
    avatarEl.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "attendee-avatar-placeholder";
    placeholder.textContent = initials;
    avatarEl.appendChild(placeholder);
  }

  const infoEl = document.createElement("div");
  infoEl.className = "attendee-info";

  const nameEl = document.createElement("div");
  nameEl.className = "attendee-name";
  nameEl.textContent = attendee.name;
  infoEl.appendChild(nameEl);

  if (intentLabel) {
    const goalEl = document.createElement("div");
    goalEl.className = "attendee-goal";
    goalEl.textContent = intentLabel;
    infoEl.appendChild(goalEl);
  }

  if (tagLine) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "attendee-interests";
    tagsEl.textContent = tagLine;
    infoEl.appendChild(tagsEl);
  }

  card.appendChild(avatarEl);
  card.appendChild(infoEl);
  return card;
}

function renderAttendeeDiscovery(attendees, myProfileId, isFullAccess) {
  const grid    = document.getElementById("attendeeDiscoveryGrid");
  const gate    = document.getElementById("attendeeDiscoveryGate");
  const section = document.getElementById("attendeeDiscoverySection");
  if (!grid || !section) return;

  const others  = attendees.filter((a) => a.profileId !== myProfileId);
  if (!others.length) return;

  const GATE_LIMIT = 6;
  const visible   = isFullAccess ? others : others.slice(0, GATE_LIMIT);
  const gated     = !isFullAccess && others.length > 0;

  grid.innerHTML = "";
  visible.forEach((a) => grid.appendChild(buildAttendeeCard(a, isFullAccess)));

  if (gated && gate) {
    const msg = gate.querySelector(".attendee-gate-message");
    if (msg) {
      msg.textContent = currentUser
        ? "Join in the Nearify app to see all attendees and connect."
        : "Sign in to see everyone attending and what they're here for.";
    }
    gate.style.display = "";
  }

  section.style.display = "";
}

async function loadAttendeeDiscovery(eventId) {
  const attendees = await fetchEventAttendees(eventId);
  if (!attendees.length) return;

  let myProfileId = null;
  if (currentUser?.id) {
    const { data: p } = await supabase
      .from("profiles").select("id").eq("user_id", currentUser.id).maybeSingle();
    myProfileId = p?.id ?? null;
  }

  const isAttendee  = myProfileId ? attendees.some((a) => a.profileId === myProfileId) : false;
  const isFullAccess = !!currentUser && isAttendee;

  renderAttendeeDiscovery(attendees, myProfileId, isFullAccess);
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
    logger.error("[PersonalConnect] Failed to render", error);
  }
}



let html2canvasLoader = null;

function slugifyPosterFileName(eventName) {
  const base = String(eventName || "nearify-event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "nearify-event";
  return `nearify-${base}-poster.png`;
}

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (html2canvasLoader) return html2canvasLoader;

  html2canvasLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.async = true;
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error("Failed to load html2canvas"));
    document.head.appendChild(script);
  });

  return html2canvasLoader;
}

async function downloadPosterCard(event) {
  const button = document.getElementById("eventDownloadPosterBtn");
  const posterCard = document.getElementById("eventPosterCard");
  if (!button || !posterCard) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing...";

  try {
    const html2canvas = await loadHtml2Canvas();
    const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
    const canvas = await html2canvas(posterCard, {
      backgroundColor: null,
      scale,
      useCORS: true,
      logging: false,
    });

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = slugifyPosterFileName(event?.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    logger.error("[EventDetail] poster download error:", error);
    button.textContent = "Download failed";
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1500);
    return;
  }

  button.textContent = originalText;
  button.disabled = false;
}
function resolvePosterImage(event) {
  const candidates = [
    event.poster_url,
    event.poster_image_url,
    event.image_url,
    event.cover_image_url,
    event.banner_url,
    event.image,
    event.poster,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

function renderPosterCard(event) {
  const media = document.getElementById("eventPosterMedia");
  const image = document.getElementById("eventPosterImage");
  const fallback = document.getElementById("eventPosterFallback");
  const title = document.getElementById("eventPosterTitle");
  const date = document.getElementById("eventPosterDate");
  const location = document.getElementById("eventPosterLocation");
  const description = document.getElementById("eventPosterDescription");
  const actions = document.getElementById("eventPosterActions");
  const tfBtn = document.getElementById("eventTestflightBtn");
  const downloadBtn = document.getElementById("eventDownloadPosterBtn");

  if (title) title.textContent = event.name || "Nearify Event";
  if (date) date.textContent = event.starts_at ? formatDateTime(event.starts_at) : "Date to be announced";
  if (location) location.textContent = event.location || "Location to be announced";
  if (description) description.textContent = event.description || "Join this event in Nearify for live attendee recommendations.";

  const posterUrl = resolvePosterImage(event);
  if (posterUrl && media && image && fallback) {
    image.src = posterUrl;
    image.alt = `${event.name || "Event"} poster`;
    media.style.display = "";
  }

  if (actions) {
    actions.innerHTML = "";
    if (downloadBtn) {
      actions.appendChild(downloadBtn);
      downloadBtn.onclick = () => downloadPosterCard(event);
    }
    if (tfBtn) actions.appendChild(tfBtn);
  }
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
    const intentSection = document.getElementById("eventIntentSection");
    const authPrompt = document.getElementById("eventAttendeeAuthPrompt");
    const signedInNote = document.getElementById("eventSignedInNote");
    const fallback = document.getElementById("eventAppFallback");

    if (heroActions) heroActions.style.display = "none";
    if (sidePanel) sidePanel.style.display = "none";
    if (sections) sections.style.display = "none";
    if (intentSection) intentSection.style.display = "none";
    if (authPrompt) authPrompt.style.display = "none";
    if (signedInNote) signedInNote.style.display = "none";
    if (fallback) fallback.style.display = "none";

    const heroEl = document.querySelector(".event-hero");
    if (heroEl) heroEl.classList.add("event-hero--past");

    await loadIntelligence(event);
  } else {
    renderPosterCard(event);

    const sections = document.getElementById("eventSections");
    if (sections) sections.style.display = "";

    wireIntentCapture();
    wireJoinActions();
    updateAuthPositioning();
    await hydrateIntent();
    await maybeContinueAfterAuth();
    await loadAttendeeDiscovery(event.id);
  }

  const skeleton = document.getElementById("eventSkeleton");
  const heroCopy = document.getElementById("eventHeroCopy");
  if (skeleton) skeleton.style.display = "none";
  if (heroCopy) heroCopy.style.display = "";
}

// PHASE 2 — RLS VERIFICATION PROBE
// Temp: remove after confirming attendee discovery access works for signed-in users.
async function verifyAttendeeDiscoveryAccess(eventId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id ?? null;
  console.log("[RLS-VERIFY] signed_in:", !!userId, "| event_id:", eventId);

  const { data: attendeeRows, error: attendeeError } = await supabase
    .from("event_attendees")
    .select("profile_id, intent_primary")
    .eq("event_id", eventId);

  console.log("[RLS-VERIFY] event_attendees rows:", attendeeRows?.length ?? 0,
    "| error:", attendeeError?.message ?? null);

  if (!attendeeRows?.length) return;

  const profileIds = attendeeRows.map((r) => r.profile_id);
  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, avatar_url, intent_primary, interests, skills")
    .in("id", profileIds);

  console.log("[RLS-VERIFY] profiles rows:", profileRows?.length ?? 0,
    "| error:", profileError?.message ?? null);

  if (profileRows?.length) {
    const sample = profileRows[0];
    console.log("[RLS-VERIFY] sample profile fields visible:", Object.keys(sample).join(", "));
    console.log("[RLS-VERIFY] sample name:", sample.name, "| intent:", sample.intent_primary,
      "| interests:", sample.interests, "| skills:", sample.skills);
  }
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

    // PHASE 2 probe — runs on every event page load, remove after verification
    await verifyAttendeeDiscoveryAccess(currentEvent.id);
  } catch (err) {
    logger.error("[EventDetail] load error:", err);
    showNotFound("Something went wrong loading this event. Please try again.");
  }
}

init();
window.__EVENT_DETAIL_BOOTED__ = true;
