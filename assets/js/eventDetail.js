import { supabase } from "./supabaseClient.js";
import { setCurrentEventId } from "./appState.js";
import { fetchIntelligence, fetchEventMeta, renderIntelligenceInto } from "./intelligence.js";

const JOIN_BASE = "https://nearify.org/join/";

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str ?? "");
  return d.innerHTML;
}

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric"
  });
}

async function fetchEvent() {
  const params = new URLSearchParams(window.location.search);
  const slug   = params.get("slug");
  const id     = params.get("id");

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

function renderQr(eventId, eventName) {
  if (typeof QRCode === "undefined") return;
  const el = document.getElementById("eventQrCode");
  if (!el) return;
  el.innerHTML = "";
  new QRCode(el, {
    text: JOIN_BASE + "?event=" + encodeURIComponent(eventId) +
          "&name="  + encodeURIComponent(eventName),
    width: 220, height: 220
  });
}

function renderMetaGrid(event, isPast) {
  const grid = document.getElementById("eventMetaGrid");
  if (!grid) return;

  const cards = [];
  if (event.location) cards.push({ label: "Location", value: event.location });
  if (event.starts_at) cards.push({ label: "Date",     value: formatDate(event.starts_at) });
  if (!isPast) cards.push({ label: "Experience", value: "Live attendee discovery" });

  grid.innerHTML = cards.map(c =>
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

// ─── Intelligence for past events ────────────────────────────────────────────

async function loadIntelligence(event) {
  const intelSection   = document.getElementById("eventIntelSection");
  const signInGate     = document.getElementById("eventIntelSignInGate");
  const signInDesc     = document.getElementById("eventIntelSignInDesc");
  const intelContainer = document.getElementById("eventIntelContainer");

  if (!intelSection) return;
  intelSection.style.display = "";

  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user ?? null;

  if (!user) {
    if (signInDesc) {
      signInDesc.textContent =
        `Sign in to see who you connected with at ${event.name} and get your full interaction report.`;
    }
    if (signInGate) signInGate.style.display = "";

    const signInBtn = document.getElementById("eventIntelSignInBtn");
    if (signInBtn) {
      signInBtn.addEventListener("click", async () => {
        signInBtn.textContent = "Redirecting…";
        signInBtn.disabled    = true;
        try {
          await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.href }
          });
        } catch (err) {
          console.error("[EventDetail] sign in error:", err);
          signInBtn.textContent = "Sign in with Google";
          signInBtn.disabled    = false;
        }
      });
    }
    return;
  }

  // Signed in — load intelligence
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

// ─── Page population ──────────────────────────────────────────────────────────

function populatePage(event) {
  const isPast = !!(event.starts_at && new Date(event.starts_at) < new Date());

  // <head> meta
  document.title = `${event.name} | Nearify`;
  const setMeta = (sel, val) => {
    const el = document.querySelector(sel);
    if (el) el.setAttribute("content", val);
  };
  setMeta('meta[property="og:title"]',        `${event.name} | Nearify`);
  setMeta('meta[name="twitter:title"]',        `${event.name} | Nearify`);
  setMeta('meta[property="og:description"]',  event.description || `Discover and connect with attendees at ${event.name} in real time.`);
  setMeta('meta[name="twitter:description"]', event.description || `Discover and connect with attendees at ${event.name} in real time.`);

  // Hero copy
  const kickerEl  = document.getElementById("eventKicker");
  const titleEl   = document.getElementById("eventTitle");
  const subheadEl = document.getElementById("eventSubhead");

  if (kickerEl)  kickerEl.textContent  = isPast ? "Past Event" : "Nearify Event";
  if (titleEl)   titleEl.textContent   = event.name;
  if (subheadEl) subheadEl.textContent = event.description ||
    (isPast
      ? "This event has ended."
      : "Nearify helps you discover who is here, connect in real time, and carry the value of the event forward.");

  renderMetaGrid(event, isPast);
  setCurrentEventId(event.id);

  if (isPast) {
    // Hide hero actions, side panel, and pre-event sections entirely
    const heroActions = document.getElementById("eventHeroActions");
    const sidePanel   = document.getElementById("eventSidePanel");
    const sections    = document.getElementById("eventSections");
    if (heroActions) heroActions.style.display = "none";
    if (sidePanel)   sidePanel.style.display   = "none";
    if (sections)    sections.style.display    = "none";

    // Full-width single-column hero
    const heroEl = document.querySelector(".event-hero");
    if (heroEl) heroEl.classList.add("event-hero--past");

    // Load intelligence inline (handles auth gate itself)
    loadIntelligence(event);
  } else {
    // Upcoming: wire up join CTA, generate QR, show pre-event sections
    const joinBtn = document.getElementById("eventJoinBtn");
    if (joinBtn) {
      joinBtn.href = "../join/?event=" + encodeURIComponent(event.id) +
                    "&name="           + encodeURIComponent(event.name);
    }
    renderQr(event.id, event.name);
    const sections = document.getElementById("eventSections");
    if (sections) sections.style.display = "";
  }

  // Reveal hero copy
  const skeleton = document.getElementById("eventSkeleton");
  const heroCopy = document.getElementById("eventHeroCopy");
  if (skeleton) skeleton.style.display = "none";
  if (heroCopy) heroCopy.style.display = "";
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const event = await fetchEvent();
    if (!event) { showNotFound(); return; }
    populatePage(event);
  } catch (err) {
    console.error("[EventDetail] load error:", err);
    showNotFound("Something went wrong loading this event. Please try again.");
  }
}

init();
