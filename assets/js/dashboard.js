/**
 * dashboard.js — Event Control Center
 *
 * Renders the homepage as a live event management dashboard for
 * authenticated organizers. Logged-out users see a minimal landing.
 *
 * Extension point for Live Mode:
 *   Each event card contains a hidden <div class="cc-live-panel" id="cc-live-<eventId}">
 *   Call getLivePanelEl(eventId) to reveal it and get a reference for DOM injection.
 */

import { supabase } from "./supabaseClient.js";
import { saveEvent, deleteEvent, getOrganizerProfileId } from "./events.js";
import { trackAppCtaClick, trackPageView } from "./analytics.js";
import { patchAppStoreLinks } from "./config.js";
import { escapeHtml, escapeAttr, copyText } from "./utils.js";
console.log("[Dashboard] dashboard.js loaded");

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_DETAIL_URL = (id) => `/events/event.html?id=${encodeURIComponent(id)}`;
const EDIT_URL         = (id) => `/admin/event-setup.html?edit=${encodeURIComponent(id)}`;

function formatDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return ""; }
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "numeric", minute: "2-digit",
    });
  } catch { return ""; }
}

function buildJoinUrl(event) {
  const params = new URLSearchParams();
  params.set("event", event.id);
  if (event.name) params.set("name", event.name);
  return `https://nearify.org/join/?${params.toString()}`;
}

function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Status ───────────────────────────────────────────────────────────────────

function isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function getEventStatus(ev) {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const startDate = ev.starts_at ? new Date(ev.starts_at) : null;
  const endDate = ev.ends_at ? new Date(ev.ends_at) : null;
  const start = startDate?.getTime() ?? null;
  const end = endDate?.getTime() ?? null;

  if (ev.is_active === false) return "ended";
  if (end && nowMs > end) return "ended";

  if (start && nowMs >= start) {
    if (end) return "live";
    return isSameLocalDay(startDate, now) ? "live" : "ended";
  }

  return "upcoming";
}

function statusLabel(s) {
  return { live: "Live", upcoming: "Upcoming", ended: "Ended" }[s] ?? "Upcoming";
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function handleSignInClick() {
  const { data } = await supabase.auth.getSession();

  if (data?.session?.user) {
    await loadDashboard();
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/index.html",
    },
  });

  if (error) console.error("[Dashboard] sign-in failed:", error);
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function fetchMyEvents() {
  const profileId = await getOrganizerProfileId();
  if (!profileId) return [];

  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, location, starts_at, ends_at, is_active, description, created_at")
    .eq("created_by", profileId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) { console.error("[Dashboard] fetchMyEvents:", error); return []; }
  return data || [];
}

async function fetchAttendeeCounts(eventIds) {
  if (!eventIds.length) return new Map();

  const { data, error } = await supabase
    .from("event_attendees")
    .select("event_id")
    .in("event_id", eventIds);

  if (error) { console.warn("[Dashboard] attendee counts:", error); return new Map(); }

  const counts = new Map();
  for (const row of (data || [])) {
    counts.set(row.event_id, (counts.get(row.event_id) || 0) + 1);
  }
  return counts;
}

async function endEvent(id) {
  return saveEvent({ id, is_active: false }, true);
}

async function createEvent(fields) {
  return saveEvent({ id: generateUUID(), ...fields }, false);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderSkeletonCards(n = 2) {
  return Array.from({ length: n }).map(() => `
    <div class="cc-event-card cc-event-card--skeleton">
      <div class="cc-event-top">
        <div style="flex:1;">
          <div class="skeleton-line" style="width:52%;height:20px;margin-bottom:10px;"></div>
          <div class="skeleton-line" style="width:34%;height:13px;"></div>
        </div>
        <div class="skeleton-line" style="width:76px;height:26px;border-radius:99px;"></div>
      </div>
      <div style="margin:16px 0 20px;">
        <div class="skeleton-line" style="width:48px;height:32px;margin-bottom:5px;border-radius:6px;"></div>
        <div class="skeleton-line" style="width:36px;height:11px;border-radius:4px;"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <div class="skeleton-line button" style="width:86px;height:34px;"></div>
        <div class="skeleton-line button" style="width:108px;height:34px;"></div>
        <div class="skeleton-line button" style="width:78px;height:34px;"></div>
      </div>
    </div>
  `).join("");
}

function renderEmptyState() {
  return `
    <div class="cc-empty-state">
      <p class="cc-empty-title">No events yet.</p>
      <p class="cc-empty-body">Create your first event to generate a QR code for your guests.</p>
    </div>
  `;
}

function renderEventCard(ev, count) {
  const status   = getEventStatus(ev);
  const jUrl     = buildJoinUrl(ev);
  const detailUrl = EVENT_DETAIL_URL(ev.id);

  const dateStr  = ev.starts_at
    ? `${formatDate(ev.starts_at)} · ${formatTime(ev.starts_at)}`
    : "";
  const metaParts = [ev.location, dateStr].filter(Boolean);
  const metaStr   = metaParts.join(" · ");

  const endBtn = status !== "ended" ? `
    <button class="btn cc-btn-danger cc-action-btn"
      data-action="end-event"
      data-event-id="${escapeAttr(ev.id)}"
      data-event-name="${escapeAttr(ev.name)}">End Event</button>` : "";

  return `
    <article class="cc-event-card cc-event-card--${status}" data-event-id="${escapeAttr(ev.id)}">

      <div class="cc-event-core">

        <div class="cc-event-top">
          <div class="cc-event-top-text">
            <h3 class="cc-event-name">${escapeHtml(ev.name)}</h3>
            ${metaStr ? `<p class="cc-event-meta">${escapeHtml(metaStr)}</p>` : ""}
          </div>
          <span class="cc-event-status cc-event-status--${status}">
            <span class="cc-status-dot"></span>${statusLabel(status)}
          </span>
        </div>

        <div class="cc-event-metrics">
          <div class="cc-metric">
            <span class="cc-metric-value">${count ?? "—"}</span>
            <span class="cc-metric-label">checked in</span>
          </div>
        </div>

        <div class="cc-event-actions">
          <button class="btn primary cc-action-btn"
            data-action="show-qr"
            data-event-id="${escapeAttr(ev.id)}"
            data-event-name="${escapeAttr(ev.name)}"
            data-join-url="${escapeAttr(jUrl)}">Show QR</button>

          <button class="btn secondary cc-action-btn"
            data-action="copy-link"
            data-url="${escapeAttr(jUrl)}">Copy Join Link</button>

          <a class="btn secondary cc-action-btn"
            href="${escapeAttr(detailUrl)}">View Event</a>

          <a class="btn secondary cc-action-btn"
            href="${escapeAttr(EDIT_URL(ev.id))}">Edit</a>

          ${endBtn}

          <button class="btn cc-btn-ghost cc-action-btn"
            data-action="archive"
            data-event-id="${escapeAttr(ev.id)}"
            data-event-name="${escapeAttr(ev.name)}">Archive</button>
        </div>

      </div>

      <!-- Live Mode panel — reveal via getLivePanelEl(eventId) when Live Mode is built -->
      <div class="cc-live-panel" id="cc-live-${escapeAttr(ev.id)}" hidden>
        <!-- host anchor status · live attendees · realtime intelligence · room activity -->
      </div>

    </article>
  `;
}

function renderDashboard(events, counts) {
  const list = document.getElementById("eventCardList");
  if (!list) return;
  list.innerHTML = events.length
    ? events.map((ev) => renderEventCard(ev, counts.get(ev.id) ?? 0)).join("")
    : renderEmptyState();
}

function renderDashboardError(err) {
  const list = document.getElementById("eventCardList");
  if (!list) return;
  list.innerHTML = `
    <div class="cc-empty-state">
      <p class="cc-empty-title">Couldn’t load events.</p>
      <p class="cc-empty-body">${escapeHtml(err?.message || "Please refresh and try again.")}</p>
    </div>
  `;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function refreshDashboard() {
  const list = document.getElementById("eventCardList");
  if (list) list.innerHTML = renderSkeletonCards();
  const events = await fetchMyEvents();
  const counts = events.length
    ? await fetchAttendeeCounts(events.map((e) => e.id))
    : new Map();
  renderDashboard(events, counts);
}

// ─── QR Modal ─────────────────────────────────────────────────────────────────

let _currentJoinUrl = null;
let _focusBeforeModal = null;

function openQrModal(eventId, eventName, jUrl) {
  _currentJoinUrl = jUrl;
  _focusBeforeModal = document.activeElement;

  const modal  = document.getElementById("qrModal");
  const title  = document.getElementById("qrModalTitle");
  const qrBox  = document.getElementById("qrModalQrCode");

  if (title) title.textContent = eventName;
  qrBox.innerHTML = "";

  if (typeof window.QRCode === "function") {
    new window.QRCode(qrBox, { text: jUrl, width: 220, height: 220 });
  }

  modal.hidden = false;
  document.body.classList.add("cc-modal-open");
  document.getElementById("closeQrModalBtn")?.focus();
  trackAppCtaClick("dashboard_show_qr", { eventId });
}

function closeQrModal() {
  document.getElementById("qrModal").hidden = true;
  document.body.classList.remove("cc-modal-open");
  _currentJoinUrl = null;
  _focusBeforeModal?.focus();
  _focusBeforeModal = null;
}

async function copyCurrentJoinLink(btn) {
  if (!_currentJoinUrl) return;
  const ok  = await copyText(_currentJoinUrl);
  const orig = btn?.textContent;
  if (btn) {
    btn.textContent = ok ? "Copied!" : "Failed";
    setTimeout(() => { btn.textContent = orig; }, 1400);
  }
}

// ─── Create Event Modal ───────────────────────────────────────────────────────

function openCreateModal() {
  _focusBeforeModal = document.activeElement;
  document.getElementById("createEventModal").hidden = false;
  document.body.classList.add("cc-modal-open");
  setTimeout(() => document.getElementById("ceEventName")?.focus(), 60);
}

function closeCreateModal() {
  document.getElementById("createEventModal").hidden = true;
  document.body.classList.remove("cc-modal-open");
  _focusBeforeModal?.focus();
  _focusBeforeModal = null;
  document.getElementById("createEventForm")?.reset();
  setCreateStatus("", false);
  const nameErr = document.getElementById("ceEventNameError");
  const nameIn  = document.getElementById("ceEventName");
  const slugEl  = document.getElementById("ceSlug");
  const slugErr = document.getElementById("ceSlugError");
  if (nameErr) nameErr.style.display = "none";
  if (nameIn)  nameIn.classList.remove("field-invalid");
  if (slugErr) slugErr.style.display = "none";
  if (slugEl)  { slugEl.classList.remove("field-invalid"); delete slugEl.dataset.userEdited; }
}

function setCreateStatus(msg, isError = false) {
  const el = document.getElementById("createEventStatus");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#f87171" : "var(--color-text-muted)";
}

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function handleCreateSubmit(e) {
  e.preventDefault();

  const nameEl  = document.getElementById("ceEventName");
  const name    = nameEl?.value.trim();
  const nameErr = document.getElementById("ceEventNameError");
  const slugEl  = document.getElementById("ceSlug");
  const slugErr = document.getElementById("ceSlugError");

  if (!name) {
    if (nameErr) nameErr.style.display = "";
    nameEl?.classList.add("field-invalid");
    nameEl?.focus();
    return;
  }
  if (nameErr) nameErr.style.display = "none";
  nameEl?.classList.remove("field-invalid");

  const rawSlug = slugEl?.value.trim();
  const slug = rawSlug || slugify(name) || null;
  if (rawSlug && !/^[a-z0-9-]+$/.test(rawSlug)) {
    if (slugErr) { slugErr.style.display = ""; slugErr.textContent = "Slug can only contain lowercase letters, numbers, and hyphens."; }
    slugEl?.classList.add("field-invalid");
    slugEl?.focus();
    return;
  }
  if (slugErr) slugErr.style.display = "none";
  slugEl?.classList.remove("field-invalid");

  const date     = document.getElementById("ceDate")?.value || null;
  const time     = document.getElementById("ceTime")?.value || null;
  const location = document.getElementById("ceLocation")?.value.trim() || null;
  const desc     = document.getElementById("ceDescription")?.value.trim() || null;
  const starts_at = date && time ? `${date}T${time}:00` : date || null;

  const submitBtn = document.getElementById("createEventSubmitBtn");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add("loading"); }
  setCreateStatus("Saving…");

  const { error } = await createEvent({ name, slug, location, starts_at, description: desc });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove("loading"); }

  if (error) {
    setCreateStatus("Error: " + error.message, true);
    return;
  }

  setCreateStatus("Event created!");
  setTimeout(async () => {
    closeCreateModal();
    await refreshDashboard();
  }, 500);
}

// ─── Page state ───────────────────────────────────────────────────────────────

function hideAllViews() {
  document.getElementById("loadingView").style.display  = "none";
  document.getElementById("landingView").style.display  = "none";
  document.getElementById("dashboardView").style.display = "none";
}

function showLanding() {
  hideAllViews();
  document.getElementById("landingView").style.display = "flex";
}

function showDashboard() {
  hideAllViews();
  document.getElementById("dashboardView").style.display = "block";
}

function showLoading() {
  showDashboard();
  const list = document.getElementById("eventCardList");
  if (list) list.innerHTML = renderSkeletonCards();
}

function initDashboard() {
  console.log("[Dashboard] init");

  bindStaticHandlers();

  // Supabase fires INITIAL_SESSION synchronously on registration (with the
  // session from storage, or null if a token exchange is still pending).
  // SIGNED_IN fires when a new sign-in completes (e.g. after OAuth redirect).
  // We do NOT use an async callback here — Supabase doesn't await them, so any
  // thrown error would be silently swallowed and leave the page blank.
  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[Dashboard] auth change:", event, !!session?.user);

    if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session?.user)) {
      showLanding();
    } else if (event === "SIGNED_IN" || (event === "INITIAL_SESSION" && session?.user)) {
      loadDashboard().catch((err) => {
        console.error("[Dashboard] loadDashboard failed:", err);
        renderDashboardError(err);
      });
    }
  });
}

async function loadDashboard() {
  showLoading();

  try {
    const events = await fetchMyEvents();
    console.log("[Dashboard] events loaded:", events.length);

    const counts = events.length
      ? await fetchAttendeeCounts(events.map((event) => event.id))
      : new Map();

    renderDashboard(events, counts);
  } catch (err) {
    console.error("[Dashboard] failed to load dashboard:", err);
    renderDashboardError(err);
  }
}

// ─── Action handlers ──────────────────────────────────────────────────────────

async function handleCopyLink(btn, url) {
  const ok   = await copyText(url);
  const orig = btn?.textContent;
  if (btn) {
    btn.textContent = ok ? "Copied!" : "Failed";
    setTimeout(() => { btn.textContent = orig; }, 1400);
  }
  trackAppCtaClick("dashboard_copy_link");
}

async function handleEndEvent(eventId, eventName) {
  if (!confirm(`End "${eventName}"?\n\nThis marks the event as finished. Attendees can still view their post-event report.`)) return;
  const { error } = await endEvent(eventId);
  if (error) { alert("Could not end event: " + error.message); return; }
  await refreshDashboard();
}

async function handleArchive(eventId, eventName) {
  if (!confirm(`Archive "${eventName}"?\n\nIt will be removed from your dashboard. This cannot be undone.`)) return;
  const { error } = await deleteEvent(eventId);
  if (error) { alert("Could not archive: " + error.message); return; }
  await refreshDashboard();
}

// ─── Handler wiring ───────────────────────────────────────────────────────────

function bindStaticHandlers() {
  // Landing
  document.getElementById("landingSignInBtn")
    ?.addEventListener("click", handleSignInClick);

  // Dashboard header
  document.getElementById("openCreateModalBtn")
    ?.addEventListener("click", openCreateModal);

  // Create modal
  document.getElementById("closeCreateModalBtn")
    ?.addEventListener("click", closeCreateModal);
  document.getElementById("createEventForm")
    ?.addEventListener("submit", handleCreateSubmit);
  document.getElementById("ceEventName")
    ?.addEventListener("input", () => {
      document.getElementById("ceEventNameError").style.display = "none";
      document.getElementById("ceEventName").classList.remove("field-invalid");
      // Auto-fill slug from name only while slug field is empty
      const slugEl = document.getElementById("ceSlug");
      if (slugEl && !slugEl.dataset.userEdited) {
        slugEl.value = slugify(document.getElementById("ceEventName").value.trim());
      }
    });
  document.getElementById("ceSlug")
    ?.addEventListener("input", (e) => {
      e.target.dataset.userEdited = e.target.value ? "1" : "";
      document.getElementById("ceSlugError").style.display = "none";
      e.target.classList.remove("field-invalid");
    });

  // QR modal buttons
  document.getElementById("closeQrModalBtn")
    ?.addEventListener("click", closeQrModal);
  document.getElementById("qrModalCloseBtn")
    ?.addEventListener("click", closeQrModal);
  document.getElementById("qrModalCopyBtn")
    ?.addEventListener("click", (e) => copyCurrentJoinLink(e.currentTarget));

  // Backdrop dismiss
  document.getElementById("createEventModal")
    ?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeCreateModal(); });
  document.getElementById("qrModal")
    ?.addEventListener("click", (e) => { if (e.target === e.currentTarget) closeQrModal(); });

  // ESC
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("qrModal")?.hidden)          closeQrModal();
    else if (!document.getElementById("createEventModal")?.hidden) closeCreateModal();
  });

  // Event card delegation (show-qr, copy-link, end-event, archive)
  document.getElementById("eventCardList")
    ?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, eventId, eventName, joinUrl, url } = btn.dataset;
      switch (action) {
        case "show-qr":   openQrModal(eventId, eventName, joinUrl); break;
        case "copy-link": await handleCopyLink(btn, url); break;
        case "end-event": await handleEndEvent(eventId, eventName); break;
        case "archive":   await handleArchive(eventId, eventName); break;
      }
    });
}

// ─── Live Mode extension point ────────────────────────────────────────────────

/**
 * Reveal the Live Mode panel for a given event card and return the element.
 * Call this from a future live-mode.js module when activating realtime:
 *
 *   import { getLivePanelEl } from "./dashboard.js";
 *   const panel = getLivePanelEl(eventId);
 *   panel.innerHTML = "...anchor status, attendees, intelligence...";
 */
export function getLivePanelEl(eventId) {
  const panel = document.getElementById(`cc-live-${eventId}`);
  if (panel) panel.hidden = false;
  return panel;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initAnalytics() {
  patchAppStoreLinks();
  trackPageView();
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("[Dashboard] DOMContentLoaded");
  initAnalytics();
  initDashboard();
});
