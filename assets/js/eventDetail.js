import { supabase, getSessionCached } from "./supabaseClient.js";
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
import { canManageEvent } from "./events.js";
import { loadOrganizerInsights } from "./organizerInsights.js";
import { renderShareButton, buildEventShareUrl, buildEventShareText } from "./share.js";

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

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function getWebJoinUrl(eventId) {
  return `/join/?event=${encodeURIComponent(eventId)}`;
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
  const { data } = await getSessionCached();
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

  if (!isMobile()) {
    // Desktop: navigate to the web join page — no beacon:// attempt
    window.location.href = getWebJoinUrl(currentEvent.id);
    return;
  }

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

  // Only attempt the app deep link on mobile — desktop stays on the event page
  if (isMobile()) {
    beginJoinFlow("after_attendee_sign_in");
  }
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

function getTagArray(value, limit = 3) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return arr.slice(0, limit).map((s) => String(s).trim()).filter(Boolean);
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
  const initials    = getInitials(attendee.name);
  const intentLabel = attendee.intent ? (INTENT_LABELS[attendee.intent] || attendee.intent) : null;
  const tags        = showDetails
    ? (getTagArray(attendee.interests).length ? getTagArray(attendee.interests) : getTagArray(attendee.skills))
    : [];

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
    goalEl.textContent = "Goal: " + intentLabel;
    infoEl.appendChild(goalEl);
  }

  if (tags.length) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "attendee-interests";
    tags.forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "attendee-interest-pill";
      pill.textContent = tag;
      tagsEl.appendChild(pill);
    });
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

async function loadAttendeeDiscovery(eventId, isPast = false) {
  const attendees = await fetchEventAttendees(eventId);

  // Render momentum indicator regardless of attendee count
  renderMomentumIndicator(attendees, isPast);

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

// ---------------------------------------------------------------------------
// SEO: JSON-LD + Canonical
// ---------------------------------------------------------------------------

function injectJsonLd(event, isPast) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": event.name,
    "description": event.description || `Connect with attendees at ${event.name} in real time.`,
    "url": `https://nearify.org/events/event.html?slug=${encodeURIComponent(event.slug || event.id)}`,
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "eventStatus": "https://schema.org/EventScheduled",
    "organizer": {
      "@type": "Organization",
      "name": "Nearify",
      "url": "https://nearify.org"
    }
  };
  if (event.starts_at) jsonLd.startDate = event.starts_at;
  if (event.ends_at) jsonLd.endDate = event.ends_at;
  if (event.location) {
    jsonLd.location = { "@type": "Place", "name": event.location };
  }

  let script = document.getElementById("nearify-jsonld");
  if (!script) {
    script = document.createElement("script");
    script.id = "nearify-jsonld";
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(jsonLd);
}

function injectCanonical(event) {
  const slug = event.slug || event.id;
  const href = `https://nearify.org/events/event.html?slug=${encodeURIComponent(slug)}`;
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

// ---------------------------------------------------------------------------
// Social proof: attendee count + momentum
// ---------------------------------------------------------------------------

function buildMomentumLine(attendees) {
  const count = attendees.length;
  if (count === 0) return null;

  // Compute intent breakdown for flavor text
  const intentCounts = {};
  attendees.forEach((a) => {
    if (a.intent) intentCounts[a.intent] = (intentCounts[a.intent] || 0) + 1;
  });

  const intentLabelsShort = {
    meet_people: "networking",
    find_cofounder: "building",
    hire: "hiring",
    explore_ideas: "exploring",
    demo_something: "demoing",
  };

  // Find top 2 intents (only if they represent meaningful portion)
  const sorted = Object.entries(intentCounts)
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c >= 2 && c / count >= 0.2);

  let flavor = "";
  if (sorted.length >= 2) {
    flavor = `${intentLabelsShort[sorted[0][0]] || ""} · ${intentLabelsShort[sorted[1][0]] || ""}`;
  } else if (sorted.length === 1 && sorted[0][1] >= 3) {
    flavor = intentLabelsShort[sorted[0][0]] || "";
  }

  return { count, flavor };
}

function renderMomentumIndicator(attendees, isPast) {
  const el = document.getElementById("eventMomentum");
  if (!el) return;

  const momentum = buildMomentumLine(attendees);
  if (!momentum) return;

  const countText = isPast
    ? `${momentum.count} attended`
    : `${momentum.count} attending`;

  let html = `<span class="momentum-count">${escapeHtml(countText)}</span>`;
  if (momentum.flavor && !isPast) {
    html += `<span class="momentum-flavor">${escapeHtml(momentum.flavor)}</span>`;
  }

  el.innerHTML = html;
  el.style.display = "";
}

async function populatePage(event) {
  const isPast = !!(event.starts_at && new Date(event.starts_at) < new Date());

  // SEO
  injectJsonLd(event, isPast);
  injectCanonical(event);

  // Better page title with location context
  const titleParts = [event.name];
  if (event.location) titleParts.push(event.location);
  titleParts.push("Nearify");
  document.title = titleParts.join(" | ");

  const setMeta = (sel, val) => {
    const el = document.querySelector(sel);
    if (el) el.setAttribute("content", val);
  };

  const ogDescription = event.description
    || `Join ${event.name}${event.location ? ` at ${event.location}` : ""} — discover and connect with attendees in real time.`;

  setMeta('meta[property="og:title"]', `${event.name} | Nearify`);
  setMeta('meta[name="twitter:title"]', `${event.name} | Nearify`);
  setMeta('meta[property="og:description"]', ogDescription);
  setMeta('meta[name="twitter:description"]', ogDescription);
  setMeta('meta[property="og:url"]', `https://nearify.org/events/event.html?slug=${encodeURIComponent(event.slug || event.id)}`);

  // Dynamic OG image — points to edge function that generates per-event SVG
  const ogImageParam = event.slug ? `slug=${encodeURIComponent(event.slug)}` : `id=${encodeURIComponent(event.id)}`;
  const ogImageUrl = `https://unndeygygkgodmmdnlup.supabase.co/functions/v1/og-image?${ogImageParam}`;
  setMeta('meta[property="og:image"]', ogImageUrl);
  setMeta('meta[property="og:image:width"]', "1200");
  setMeta('meta[property="og:image:height"]', "630");
  // Twitter/X fallback to static PNG (SVG not supported on X)
  setMeta('meta[name="twitter:image"]', "https://nearify.org/assets/images/og-default.png");

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

  // Share button — rendered into the momentum area for both past and upcoming
  const momentumEl = document.getElementById("eventMomentum");
  if (momentumEl) {
    renderShareButton(momentumEl, {
      title: event.name + " | Nearify",
      text: buildEventShareText(event),
      url: buildEventShareUrl(event),
    }, { label: "Share", className: "btn secondary cc-action-btn", trackCta: "event_detail_share" });
  }

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

    await loadAttendeeDiscovery(event.id, true);
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
    await loadAttendeeDiscovery(event.id, false);
  }

  const skeleton = document.getElementById("eventSkeleton");
  const heroCopy = document.getElementById("eventHeroCopy");
  if (skeleton) skeleton.style.display = "none";
  if (heroCopy) heroCopy.style.display = "";
}

async function maybeShowOrganizerSection(event) {
  const section = document.getElementById("organizerSection");
  if (!section) return;
  const canManage = await canManageEvent(event);
  if (!canManage) return;
  section.style.display = "";
  await loadOrganizerInsights(event);
}

// ---------------------------------------------------------------------------
// Post-creation success banner
// ---------------------------------------------------------------------------

function maybeShowCreatedBanner(event) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("created") !== "1") return;

  const banner = document.getElementById("eventCreatedBanner");
  if (!banner) return;

  banner.style.display = "";

  // Clean the URL (remove ?created=1) without reload
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("created");
  window.history.replaceState({}, "", cleanUrl.toString());

  // Wire quick actions
  const copyBtn = document.getElementById("createdCopyLink");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const slug = event.slug || event.id;
      const url = `https://nearify.org/events/event.html?slug=${encodeURIComponent(slug)}`;
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = "Copied";
        setTimeout(() => { copyBtn.textContent = "Copy link"; }, 1500);
      } catch {
        copyBtn.textContent = "Failed";
        setTimeout(() => { copyBtn.textContent = "Copy link"; }, 1500);
      }
    });
  }

  const qrBtn = document.getElementById("createdShowQr");
  if (qrBtn) {
    qrBtn.addEventListener("click", () => {
      // Scroll to the poster/QR section
      const poster = document.getElementById("eventSidePanel");
      if (poster) poster.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    banner.style.opacity = "0";
    setTimeout(() => { banner.style.display = "none"; }, 300);
  }, 8000);
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
    await maybeShowOrganizerSection(currentEvent);

    // Show success banner if arriving from event creation
    maybeShowCreatedBanner(currentEvent);

    patchAppStoreLinks();
    trackPageView({ eventId: currentEvent.id });
    wireAppCtaTracking();
  } catch (err) {
    logger.error("[EventDetail] load error:", err);
    showNotFound("Something went wrong loading this event. Please try again.");
  }
}

init();
window.__EVENT_DETAIL_BOOTED__ = true;
