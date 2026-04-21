import { supabase } from "./supabaseClient.js";
import { loadGhostSession, createGhostSession } from "./ghostSession.js";

const els = {
  joinKicker: document.getElementById("joinKicker"),
  joinTitle: document.getElementById("joinTitle"),
  joinDescription: document.getElementById("joinDescription"),
  joinEventMeta: document.getElementById("joinEventMeta"),
  payloadText: document.getElementById("payloadText"),
  joinQrBox: document.getElementById("joinQrBox"),
  joinQrCode: document.getElementById("joinQrCode"),
  intentStep: document.getElementById("intentStep"),
};

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    eventId: params.get("event"),
    eventName: params.get("name"),
  };
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    const dt = new Date(value);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(dt);
  } catch {
    return value;
  }
}

function setText(el, value) {
  if (!el) return;
  el.textContent = value ?? "";
}

function show(el) {
  if (!el) return;
  el.style.display = "";
}

function hide(el) {
  if (!el) return;
  el.style.display = "none";
}

async function fetchEvent(eventId) {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, description, location, starts_at, ends_at, is_active, deleted_at")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[Join] Failed to fetch event", error);
    throw error;
  }

  return data;
}

function renderEventMeta(event) {
  if (!document.getElementById("joinEventMeta") || !event) return;

  const bits = [
    event.location,
    formatDateTime(event.starts_at),
  ].filter(Boolean);

  if (!bits.length) {
    hide(document.getElementById("joinEventMeta"));
    return;
  }

  document.getElementById("joinEventMeta").innerHTML = bits
    .map((bit) => `<span class="join-meta-chip">${escapeHtml(bit)}</span>`)
    .join("");

  show(document.getElementById("joinEventMeta"));
}

function renderEventDetails(event, fallbackName) {
  const title = event?.name || fallbackName || "Join Event";

  setText(els.joinKicker, "Join Event");
  setText(els.joinTitle, title);

  if (event?.description) {
    setText(els.joinDescription, event.description);
  } else {
    setText(
      els.joinDescription,
      "Nearify shows you who's actually at this event so you can discover and connect in real time."
    );
  }

  renderEventMeta(event);
}

function renderPayload(eventId) {
  const beaconUrl = `beacon://event/${eventId}`;
  setText(els.payloadText, beaconUrl);
  renderQrCode(beaconUrl);
}

function renderQrCode(value) {
  if (!els.joinQrBox || !els.joinQrCode || !value) return;

  els.joinQrCode.innerHTML = "";

  if (typeof window.QRCode !== "function") {
    console.warn("[Join] QRCode library not available");
    hide(els.joinQrBox);
    return;
  }

  new window.QRCode(els.joinQrCode, {
    text: value,
    width: 180,
    height: 180,
  });

  show(els.joinQrBox);
}

async function ensureGhostForEvent(eventId, displayName = "Guest") {
  if (!eventId) return null;

  const existing = loadGhostSession(eventId);
  if (existing?.ghostToken) {
    console.log("[Ghost] Reusing existing ghost session", existing);
    return existing;
  }

  const created = await createGhostSession(eventId, displayName);
  console.log("[Ghost] Created new ghost session", created);
  return created;
}

function renderGhostState(ghost) {
  if (!ghost) return;
  console.log("[Ghost] Active session", ghost);
}

function showIntentStep() {
  if (!els.intentStep) return;
  show(els.intentStep);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInvalidState(message) {
  setText(els.joinKicker, "Join Event");
  setText(els.joinTitle, "Event unavailable");
  setText(
    els.joinDescription,
    message || "This event link is invalid or the event is no longer available."
  );
  setText(els.payloadText, "No valid event found.");
  hide(els.joinQrBox);
  hide(els.intentStep);
  hide(els.joinEventMeta);
}

async function initJoinPage() {
  const { eventId, eventName } = getQueryParams();

  if (!eventId) {
    renderInvalidState("This link is missing an event id.");
    return;
  }

  try {
    const event = await fetchEvent(eventId);

    if (!event || event.deleted_at || event.is_active === false) {
      renderInvalidState("This event is no longer active.");
      return;
    }

    renderEventDetails(event, eventName);
    renderPayload(event.id);

    const ghost = await ensureGhostForEvent(event.id);
    renderGhostState(ghost);

    showIntentStep();
  } catch (error) {
    console.error("[Join] Initialization failed", error);
    renderInvalidState("We couldn't load this event right now.");
  }
}

document.addEventListener("DOMContentLoaded", initJoinPage);
