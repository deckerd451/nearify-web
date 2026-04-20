import { supabase } from "./supabaseClient.js";
import { setCurrentEventId } from "./appState.js";

const TESTFLIGHT_URL = "https://testflight.apple.com/join/ZayvEbAy";
const JOIN_BASE      = "https://nearify.org/join/";

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

function renderMetaGrid(event) {
  const grid = document.getElementById("eventMetaGrid");
  if (!grid) return;

  const cards = [];
  if (event.location) cards.push({ label: "Location", value: event.location });
  if (event.starts_at) cards.push({ label: "Date",     value: formatDate(event.starts_at) });
  cards.push({ label: "Experience", value: "Live attendee discovery" });

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

function populatePage(event) {
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
  const titleEl   = document.getElementById("eventTitle");
  const subheadEl = document.getElementById("eventSubhead");
  const joinBtn   = document.getElementById("eventJoinBtn");

  if (titleEl)   titleEl.textContent = event.name;
  if (subheadEl) subheadEl.textContent = event.description ||
    "Nearify helps you discover who is here, connect in real time, and carry the value of the event forward.";

  if (joinBtn) {
    joinBtn.href = "../join/?event=" + encodeURIComponent(event.id) +
                  "&name="           + encodeURIComponent(event.name);
  }

  renderMetaGrid(event);
  renderQr(event.id, event.name);
  setCurrentEventId(event.id);

  // Show skeleton → real content swap
  const skeleton = document.getElementById("eventSkeleton");
  const heroCopy = document.getElementById("eventHeroCopy");
  const sections = document.getElementById("eventSections");
  if (skeleton) skeleton.style.display = "none";
  if (heroCopy) heroCopy.style.display = "";
  if (sections) sections.style.display = "";
}

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
