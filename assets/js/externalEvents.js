/**
 * externalEvents.js — Admin: External Event review and activation.
 *
 * Loads rows from external_events, renders them grouped by match state,
 * and allows an authenticated admin to promote an unmatched external event
 * into a canonical Nearify events row.
 *
 * Auth: relies on existing Supabase session (same pattern as event-setup).
 * RLS: reads/updates external_events via the anon/user client.
 *      Any RLS errors are surfaced clearly — no server-side bypass.
 */

import { supabase } from "./supabaseClient.js";
import { saveEvent, getOrganizerProfileId } from "./events.js";
import { copyText } from "./utils.js";
import { logger } from "./logger.js";
import { requireAdminAccess } from "./adminAccess.js";

const NEARIFY_BASE = "https://nearify.org";

// Module-level state — rehydrated on each load/refresh
let allExternalEvents = [];    // full unfiltered dataset
let activeSourceFilter = "";   // "" = all sources

// ── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateSlug(title, startTime) {
  const base = slugify(title);
  if (!startTime) return base;
  try {
    const d = new Date(startTime);
    const dateSuffix =
      `${d.getFullYear()}-` +
      `${String(d.getMonth() + 1).padStart(2, "0")}-` +
      `${String(d.getDate()).padStart(2, "0")}`;
    return `${base}-${dateSuffix}`;
  } catch {
    return base;
  }
}

// Map internal source keys to the ?source= param the join page expects.
// "meetup_charlestonhacks" → "meetup" triggers isMeetupSource on join page.
function getJoinSource(sourceKey) {
  if (!sourceKey) return "external";
  if (sourceKey.startsWith("meetup_")) return "meetup";
  return sourceKey;
}

function buildJoinUrl(eventId, sourceKey, sourceEventId) {
  const src = getJoinSource(sourceKey);
  return (
    `${NEARIFY_BASE}/join/?event=${encodeURIComponent(eventId)}` +
    `&source=${encodeURIComponent(src)}` +
    `&source_event_id=${encodeURIComponent(sourceEventId || "")}`
  );
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadExternalEvents() {
  logger.log("[ExtEvents] Loading external_events from Supabase");

  const { data, error } = await supabase
    .from("external_events")
    .select(
      "id, source, source_event_id, title, description, start_time, end_time, location, source_url, matched_event_id, image_url"
    )
    .order("start_time", { ascending: true });

  if (error) {
    logger.warn("[ExtEvents] Load error:", error.code, error.message);
    return { data: null, error };
  }

  return { data: data || [], error: null };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderSourceBadge(sourceKey) {
  return `<span class="ext-source-badge">${escapeHtml(sourceKey || "unknown")}</span>`;
}

function renderUnmatchedCard(ev) {
  const dateStr = formatDateTime(ev.start_time);
  const metaParts = [dateStr, ev.location].filter(Boolean);
  const desc = (ev.description || "").substring(0, 180);

  return `
    <div class="ext-event-card" id="ext-card-${escapeAttr(ev.id)}" data-extid="${escapeAttr(ev.id)}">
      <div class="ext-card-top">
        ${renderSourceBadge(ev.source)}
        <span class="ext-event-title">${escapeHtml(ev.title)}</span>
      </div>
      ${metaParts.length ? `<div class="ext-event-meta">${metaParts.map(escapeHtml).join(" &middot; ")}</div>` : ""}
      ${desc ? `<p class="ext-event-desc">${escapeHtml(desc)}${ev.description && ev.description.length > 180 ? "…" : ""}</p>` : ""}
      <div class="ext-card-actions">
        ${ev.source_url ? `<a href="${escapeAttr(ev.source_url)}" class="admin-btn admin-btn-copy" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ""}
        <button
          class="admin-btn admin-btn-edit"
          data-action="activate"
          data-extid="${escapeAttr(ev.id)}"
        >Activate on Nearify</button>
      </div>
      <p class="ext-card-status field-help" id="ext-status-${escapeAttr(ev.id)}" aria-live="polite"></p>
    </div>`;
}

function renderMatchedCard(ev) {
  const dateStr = formatDateTime(ev.start_time);
  const metaParts = [dateStr, ev.location].filter(Boolean);
  const joinUrl = ev.matched_event_id
    ? buildJoinUrl(ev.matched_event_id, ev.source, ev.source_event_id)
    : null;

  return `
    <div class="ext-event-card ext-event-card--matched" id="ext-card-${escapeAttr(ev.id)}">
      <div class="ext-card-top">
        ${renderSourceBadge(ev.source)}
        <span class="ext-event-title">${escapeHtml(ev.title)}</span>
        <span class="card-badge" style="margin:0; font-size:10px;">Matched</span>
      </div>
      ${metaParts.length ? `<div class="ext-event-meta">${metaParts.map(escapeHtml).join(" &middot; ")}</div>` : ""}
      <div class="ext-event-meta">
        Nearify event: <code style="font-size:11px; color:#8fa0b8;">${escapeHtml(ev.matched_event_id || "")}</code>
      </div>
      ${joinUrl ? `
      <div class="ext-card-actions">
        ${ev.source_url ? `<a href="${escapeAttr(ev.source_url)}" class="admin-btn admin-btn-copy" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ""}
        <button class="admin-btn admin-btn-copy" data-action="copy-join" data-url="${escapeAttr(joinUrl)}">Copy join URL</button>
        <a href="${escapeAttr(joinUrl)}" class="admin-btn admin-btn-copy" target="_blank" rel="noopener noreferrer">Open join page ↗</a>
        <button class="admin-btn admin-btn-delete" data-action="remove-match" data-extid="${escapeAttr(ev.id)}">Remove</button>
      </div>` : ""}
    </div>`;
}

function renderSuccessState(ev, newEventId, joinUrl) {
  return `
    <div class="ext-event-card ext-event-card--activated" id="ext-card-${escapeAttr(ev.id)}">
      <div class="ext-success-state">
        <div class="ext-success-headline">
          <span aria-hidden="true">✓</span>
          Activated on Nearify
        </div>
        <div class="ext-event-title" style="font-size:15px;">${escapeHtml(ev.title)}</div>
        <div class="ext-event-meta">
          Nearify event ID: <code style="font-size:11px;">${escapeHtml(newEventId)}</code>
        </div>
        <div class="ext-success-join-row">
          <span class="ext-join-url-text">${escapeHtml(joinUrl)}</span>
          <button class="admin-btn admin-btn-copy" data-action="copy-join" data-url="${escapeAttr(joinUrl)}">Copy join URL</button>
          <a href="${escapeAttr(joinUrl)}" class="admin-btn admin-btn-copy" target="_blank" rel="noopener noreferrer">Open ↗</a>
        </div>
      </div>
    </div>`;
}

function getFilteredEvents() {
  if (!activeSourceFilter) return allExternalEvents;
  return allExternalEvents.filter(ev => ev.source === activeSourceFilter);
}

function renderLists() {
  const filtered = getFilteredEvents();
  const unmatched = filtered.filter(ev => !ev.matched_event_id);
  const matched   = filtered.filter(ev =>  ev.matched_event_id);

  // Status bar
  const statusBar = document.getElementById("statusBar");
  const countPending = document.getElementById("countPending");
  const countMatched = document.getElementById("countMatched");
  if (statusBar && countPending && countMatched) {
    countPending.textContent = `${unmatched.length} pending`;
    countMatched.textContent = `${matched.length} matched`;
    statusBar.style.display = "flex";
  }

  // Unmatched
  const unmatchedList = document.getElementById("unmatchedList");
  if (unmatchedList) {
    unmatchedList.innerHTML = unmatched.length
      ? unmatched.map(renderUnmatchedCard).join("")
      : `<div class="ext-empty">No unmatched events${activeSourceFilter ? " for this source" : ""}. All imports are matched or nothing has been synced yet.</div>`;
  }

  // Matched
  const matchedList = document.getElementById("matchedList");
  if (matchedList) {
    matchedList.innerHTML = matched.length
      ? matched.map(renderMatchedCard).join("")
      : `<div class="ext-empty">No matched events${activeSourceFilter ? " for this source" : ""}.</div>`;
  }
}

function buildFilterButtons() {
  const sources = [...new Set(allExternalEvents.map(ev => ev.source).filter(Boolean))].sort();
  const container = document.getElementById("filterBtns");
  if (!container) return;

  container.innerHTML = `<button class="ext-filter-btn active" data-source="">All</button>` +
    sources.map(s => `<button class="ext-filter-btn" data-source="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join("");

  container.querySelectorAll(".ext-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".ext-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeSourceFilter = btn.dataset.source;
      renderLists();
    });
  });
}

// ── Activation ───────────────────────────────────────────────────────────────

async function activateExternalEvent(extId) {
  const ev = allExternalEvents.find(e => e.id === extId);
  if (!ev) return;

  const card = document.getElementById(`ext-card-${extId}`);
  const statusEl = document.getElementById(`ext-status-${extId}`);
  const activateBtn = card?.querySelector(`[data-action="activate"]`);

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#f87171" : "#8fa0b8";
  }

  if (activateBtn) {
    activateBtn.disabled = true;
    activateBtn.textContent = "Activating…";
  }
  setStatus("Creating Nearify event…");

  // 1 — Resolve profile (gives a clear early error if missing)
  const profileId = await getOrganizerProfileId();
  if (!profileId) {
    if (activateBtn) { activateBtn.disabled = false; activateBtn.textContent = "Activate on Nearify"; }
    setStatus(
      "No organizer profile found for your account. Create a profile in the Nearify iOS app first.",
      true
    );
    return;
  }

  // 2 — Create canonical events row
  const newId = crypto.randomUUID();
  const slug  = generateSlug(ev.title, ev.start_time);

  logger.log("[ExtEvents] Activating external event", { extId: ev.id, newId, slug });

  const { data: eventData, error: saveError } = await saveEvent(
    {
      id:          newId,
      name:        ev.title,
      slug:        slug || null,
      description: ev.description || null,
      location:    ev.location    || null,
      starts_at:   ev.start_time  || null,
      ends_at:     ev.end_time    || null,
      is_active:   true,
    },
    false // create, not update
  );

  if (saveError) {
    logger.warn("[ExtEvents] saveEvent failed:", saveError);
    if (activateBtn) { activateBtn.disabled = false; activateBtn.textContent = "Activate on Nearify"; }
    setStatus(`Could not create event: ${saveError.message || saveError.code || "Unknown error"}`, true);
    return;
  }

  const createdEvent = Array.isArray(eventData) ? eventData[0] : eventData;
  if (!createdEvent?.id) {
    if (activateBtn) { activateBtn.disabled = false; activateBtn.textContent = "Activate on Nearify"; }
    setStatus("Event insert returned no data — check Supabase RLS on events.", true);
    return;
  }

  setStatus("Linking to external event record…");
  logger.log("[ExtEvents] events row created:", createdEvent.id);

  // 3 — Link external_events.matched_event_id
  const { error: linkError } = await supabase
    .from("external_events")
    .update({
      matched_event_id: createdEvent.id,
      updated_at:       new Date().toISOString(),
    })
    .eq("id", ev.id);

  const joinUrl = buildJoinUrl(createdEvent.id, ev.source, ev.source_event_id);

  if (linkError) {
    // Event was created but linking failed — report both pieces clearly.
    logger.warn("[ExtEvents] Link update failed:", linkError);
    if (card) {
      card.innerHTML = `
        <div class="ext-success-state">
          <div class="ext-success-headline">
            <span aria-hidden="true">✓</span> Nearify event created (link step failed)
          </div>
          <div class="ext-event-title" style="font-size:15px;">${escapeHtml(ev.title)}</div>
          <div class="ext-event-meta" style="color:#fbbf24;">
            The events row was created (ID: <code>${escapeHtml(createdEvent.id)}</code>)
            but updating <code>external_events.matched_event_id</code> failed:<br>
            ${escapeHtml(linkError.message || linkError.code || "Unknown RLS or permission error")}
          </div>
          <div class="ext-event-meta">
            You can update it manually in Supabase Studio, or check RLS on external_events.
          </div>
          <div class="ext-success-join-row" style="margin-top:6px;">
            <span class="ext-join-url-text">${escapeHtml(joinUrl)}</span>
            <button class="admin-btn admin-btn-copy" data-action="copy-join" data-url="${escapeAttr(joinUrl)}">Copy join URL</button>
          </div>
        </div>`;
    }
    // Still update local state so the join URL is available
    ev.matched_event_id = createdEvent.id;
    return;
  }

  logger.log("[ExtEvents] external_events linked to", createdEvent.id);

  // 4 — Update local state and replace card with success view
  ev.matched_event_id = createdEvent.id;

  if (card) {
    card.outerHTML = renderSuccessState(ev, createdEvent.id, joinUrl);
    // Re-wire copy buttons that are now in the DOM
    wireCopyButtons(document.getElementById(`ext-card-${extId}`));
  }
}

// ── Event delegation ─────────────────────────────────────────────────────────

function wireCopyButtons(root) {
  if (!root) return;
  root.querySelectorAll("[data-action='copy-join']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url;
      if (!url) return;
      const ok = await copyText(url);
      const orig = btn.textContent;
      btn.textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });
}

function wireListDelegation(listId) {
  const list = document.getElementById(listId);
  if (!list) return;

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === "activate") {
      const extId = btn.dataset.extid;
      if (extId) await activateExternalEvent(extId);
      return;
    }

    if (action === "copy-join") {
      const url = btn.dataset.url;
      if (!url) return;
      const ok = await copyText(url);
      const orig = btn.textContent;
      btn.textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(() => { btn.textContent = orig; }, 1500);
      return;
    }

    if (action === "remove-match") {
      const extId = btn.dataset.extid;
      if (extId) await unmatchExternalEvent(extId);
      return;
    }
  });
}

async function unmatchExternalEvent(extId) {
  const ev = allExternalEvents.find(e => e.id === extId);
  if (!ev) return;

  const card = document.getElementById(`ext-card-${extId}`);
  const removeBtn = card?.querySelector(`[data-action="remove-match"]`);

  if (removeBtn) {
    removeBtn.disabled = true;
    removeBtn.textContent = "Removing…";
  }

  const { error: updateError } = await supabase
    .from("external_events")
    .update({ matched_event_id: null, updated_at: new Date().toISOString() })
    .eq("id", extId);

  if (updateError) {
    logger.warn("[ExtEvents] Unmatch update failed:", updateError);
    if (removeBtn) { removeBtn.disabled = false; removeBtn.textContent = "Remove"; }
    return;
  }

  // Re-fetch the row to confirm the write persisted (Supabase JS v2 returns
  // no error when RLS silently blocks an update, so we verify via a fresh read).
  const { data: rows, error: fetchError } = await supabase
    .from("external_events")
    .select("matched_event_id")
    .eq("id", extId)
    .limit(1);

  if (fetchError) {
    logger.warn("[ExtEvents] Post-unmatch fetch failed:", fetchError);
    if (removeBtn) { removeBtn.disabled = false; removeBtn.textContent = "Remove"; }
    return;
  }

  const persisted = rows?.[0];
  if (!persisted || persisted.matched_event_id !== null) {
    // Update was silently rejected (RLS or missing row) — restore button with error hint.
    logger.warn("[ExtEvents] Unmatch did not persist — matched_event_id still set:", persisted);
    if (card) {
      const statusEl = card.querySelector(".ext-card-status") ??
        Object.assign(document.createElement("p"), { className: "ext-card-status field-help" });
      statusEl.textContent = "Remove failed: check RLS policy on external_events (UPDATE permission).";
      statusEl.style.color = "#f87171";
      card.appendChild(statusEl);
    }
    if (removeBtn) { removeBtn.disabled = false; removeBtn.textContent = "Remove"; }
    return;
  }

  // Confirmed persisted — update local state and re-render.
  ev.matched_event_id = null;
  renderLists();
}

// ── Load & refresh ────────────────────────────────────────────────────────────

function showLoadStatus(msg, isError = false) {
  const wrap = document.getElementById("loadStatus");
  const el   = document.getElementById("loadStatusMsg");
  if (!wrap || !el) return;
  el.textContent = msg;
  el.style.color = isError ? "#f87171" : "#8fa0b8";
  wrap.style.display = msg ? "" : "none";
}

async function loadAndRender() {
  if (loadAndRender._inFlight) return loadAndRender._inFlight;
  loadAndRender._inFlight = (async () => {
  showLoadStatus("Loading external events…");

  const unmatchedList = document.getElementById("unmatchedList");
  const matchedList   = document.getElementById("matchedList");
  if (unmatchedList) unmatchedList.innerHTML = `<p class="field-help" style="max-width:1200px; margin:0 auto;">Loading…</p>`;
  if (matchedList)   matchedList.innerHTML   = "";

  const { data, error } = await loadExternalEvents();

  if (error) {
    const hint =
      error.code === "42501" || (error.message || "").toLowerCase().includes("policy")
        ? "RLS is blocking reads. Grant SELECT on external_events to the authenticated role in Supabase Studio."
        : error.message || "Unknown error";
    showLoadStatus(`Could not load external events: ${hint}`, true);
    if (unmatchedList) {
      unmatchedList.innerHTML = `<div class="ext-empty" style="color:#f87171;">
        Failed to load: ${escapeHtml(hint)}
      </div>`;
    }
    return;
  }

  allExternalEvents = data;
  logger.log("[ExtEvents] Loaded", data.length, "external events");

  buildFilterButtons();
  renderLists();

  const total = data.length;
  showLoadStatus(
    total === 0
      ? "No external events found. Run the Cloudflare Worker sync to import events."
      : `Loaded ${total} external event${total === 1 ? "" : "s"}.`
  );
  // Auto-clear the status bar after a moment
  setTimeout(() => showLoadStatus(""), 3500);
  })().finally(() => { loadAndRender._inFlight = null; });
  return loadAndRender._inFlight;
}

// ── Auth gate ─────────────────────────────────────────────────────────────────

function initAuthGate() {
  const gate       = document.getElementById("adminAuthGate");
  const restricted = document.getElementById("adminRestricted");
  const content    = document.getElementById("adminContent");

  supabase.auth.onAuthStateChange((event, session) => {
    logger.log("[ExtEvents] auth:", event, !!session?.user);
    const user = session?.user ?? null;
    const result = requireAdminAccess(user, {
      gateEl:       gate,
      contentEl:    content,
      restrictedEl: restricted,
    });
    if (result === "granted") loadAndRender();
  });

  const signInBtn  = document.getElementById("adminSignInBtn");
  const authStatus = document.getElementById("adminAuthStatus");
  if (signInBtn) {
    signInBtn.addEventListener("click", async () => {
      if (authStatus) authStatus.textContent = "Redirecting…";
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });
      if (error && authStatus) authStatus.textContent = "Sign-in failed: " + error.message;
    });
  }
}

// ── Page init ────────────────────────────────────────────────────────────────

function init() {
  initAuthGate();

  // Refresh button
  document.getElementById("refreshBtn")?.addEventListener("click", loadAndRender);

  // Toggle matched section
  const toggleBtn  = document.getElementById("toggleMatchedBtn");
  const matchedList = document.getElementById("matchedList");
  if (toggleBtn && matchedList) {
    toggleBtn.addEventListener("click", () => {
      const isHidden = matchedList.style.display === "none";
      matchedList.style.display = isHidden ? "" : "none";
      toggleBtn.textContent     = isHidden ? "Hide" : "Show";
    });
  }

  // Event delegation for list actions
  wireListDelegation("unmatchedList");
  wireListDelegation("matchedList");
}

document.addEventListener("DOMContentLoaded", init);
