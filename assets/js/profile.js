import { supabase } from "./supabaseClient.js";
import { APP_STORE_URL, patchAppStoreLinks } from "./config.js";
import { trackPageView, trackAppCtaClick } from "./analytics.js";
import { getCurrentUser } from "./appState.js";
import { INTENT_LABELS, buildRelationshipNarrative } from "./profileNarrative.js";

function getInitials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = String(str ?? "");
  return d.innerHTML;
}

function showState(id) {
  ["profileSkeleton", "profileContent", "profileNotFound"].forEach((s) => {
    const el = document.getElementById(s);
    if (el) el.hidden = s !== id;
  });
}

function renderRelationshipContext(ctx, options = {}) {
  const el = document.getElementById("profileRelContext");
  if (!el) return;

  const status = ctx.relationship_status;
  const count  = ctx.encounter_count ?? 0;
  const first  = ctx.first_encounter_event_name;
  const last   = ctx.last_encounter_event_name;
  const relationshipMode = options.relationshipMode === true;
  el.innerHTML = "";
  el.classList.toggle("profile-rel-context-history", relationshipMode);

  if (!status && count === 0 && !ctx.shared_intent) { el.hidden = true; return; }

  const statusLabels = {
    confirmed:         "Saved in My Connections",
    proposed_by_me:    "You saved them — waiting for them to save you back",
    proposed_by_them:  "They saved you and want to stay in touch",
    ghost_claimed:     "You saved each other at this event",
  };
  const statusText = statusLabels[status] ?? null;

  const details = [];
  if (count === 1 && first) {
    details.push(`Met at ${first}`);
  } else if (count > 1) {
    details.push(`${count} events together`);
    if (first) details.push(`First: ${first}`);
    if (last && last !== first) details.push(`Most recent: ${last}`);
  }
  if (ctx.shared_intent && INTENT_LABELS[ctx.shared_intent]) {
    details.push(`You were both ${INTENT_LABELS[ctx.shared_intent]}`);
  }

  if (!statusText && !details.length) { el.hidden = true; return; }

  if (relationshipMode) {
    const heading = document.createElement("h2");
    heading.className = "profile-rel-context-heading";
    heading.textContent = "Relationship history";
    el.appendChild(heading);

    const list = document.createElement("dl");
    list.className = "profile-rel-history-list";

    const addHistoryItem = (label, value) => {
      if (!value) return;
      const item = document.createElement("div");
      item.className = "profile-rel-history-item";

      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;

      item.append(term, description);
      list.appendChild(item);
    };

    addHistoryItem("Connection", statusText);
    addHistoryItem("First meeting", first || (count > 0 ? "Recorded in your Nearify history" : null));
    addHistoryItem("Last encounter", last || (count > 0 ? first : null));
    addHistoryItem("Events together", count > 0 ? `${count} ${count === 1 ? "event" : "events"}` : null);
    addHistoryItem("Shared intent", ctx.shared_intent && INTENT_LABELS[ctx.shared_intent] ? INTENT_LABELS[ctx.shared_intent] : null);

    if (list.children.length) el.appendChild(list);
  } else {
    if (statusText) {
      const statusEl = document.createElement("p");
      statusEl.className = "profile-rel-context-status";
      statusEl.textContent = statusText;
      el.appendChild(statusEl);
    }
    details.forEach((d) => {
      const p = document.createElement("p");
      p.className = "profile-rel-context-detail";
      p.textContent = d;
      el.appendChild(p);
    });
  }

  const narrativeEl = document.getElementById("profileRelNarrative");
  if (narrativeEl) {
    const sentences = buildRelationshipNarrative(ctx);
    if (sentences.length) {
      narrativeEl.textContent = sentences.join(" ");
      narrativeEl.hidden = false;
    }
  }

  el.hidden = false;
}

function renderProfile(profile, eventId, eventName, options = {}) {
  const name     = profile.name || "Attendee";
  const initials = getInitials(name);

  const avatarEl = document.getElementById("profileAvatar");
  if (avatarEl) {
    avatarEl.innerHTML = profile.avatar_url
      ? `<img class="profile-avatar-img" src="${escapeHtml(profile.avatar_url)}" alt="${escapeHtml(initials)}" />`
      : `<div class="profile-avatar-placeholder">${escapeHtml(initials)}</div>`;
  }

  const relationshipMode = options.relationshipMode === true;

  const nameEl = document.getElementById("profileName");
  if (nameEl) {
    nameEl.textContent = relationshipMode ? `How You Know ${name}` : name;
    nameEl.classList.toggle("profile-name-relationship", relationshipMode);
  }

  const contextEl = document.getElementById("profileContext");
  if (contextEl) {
    contextEl.textContent = relationshipMode
      ? "A relationship-history page built from the moments you already shared on Nearify."
      : eventName ? `Attending ${eventName}` : "Nearify member — save people you meet and remember why they matter";
  }

  const openAppBtn = document.getElementById("profileOpenAppBtn");
  const getAppLink = document.getElementById("profileGetAppLink");

  if (openAppBtn && eventId) {
    const deepLink = `beacon://event/${encodeURIComponent(eventId)}`;
    openAppBtn.addEventListener("click", () => {
      trackAppCtaClick("profile_open_app", { eventId });
      window.location.href = deepLink;
      setTimeout(() => {
        const fallback = document.getElementById("profileGetAppFallback");
        if (fallback && document.visibilityState === "visible") fallback.hidden = false;
      }, 1200);
    });
  } else if (openAppBtn) {
    openAppBtn.addEventListener("click", () => {
      trackAppCtaClick("profile_get_app");
      window.location.href = APP_STORE_URL;
    });
    openAppBtn.textContent = "Get the App";
    if (getAppLink) getAppLink.hidden = true;
  }

  showState("profileContent");
}

async function init() {
  patchAppStoreLinks();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const params    = new URLSearchParams(window.location.search);
  const rawProfileId = params.get("id");
  const rawEventId   = params.get("event");
  const profileId  = rawProfileId && UUID_RE.test(rawProfileId) ? rawProfileId : null;
  const eventId    = rawEventId   && UUID_RE.test(rawEventId)   ? rawEventId   : null;
  const fromConnections = params.get("from") === "connections";

  trackPageView({ profileId: profileId ?? undefined, eventId: eventId ?? undefined });

  if (!profileId) {
    showState("profileNotFound");
    return;
  }

  const { data: rows, error } = await supabase.rpc("get_public_profile_brief", {
    p_profile_id: profileId,
  });

  if (error || !rows?.length) {
    showState("profileNotFound");
    return;
  }

  let eventName = null;
  if (eventId) {
    const { data: event } = await supabase
      .from("events")
      .select("name")
      .eq("id", eventId)
      .maybeSingle();
    eventName = event?.name ?? null;
  }

  renderProfile(rows[0], eventId, eventName, { relationshipMode: fromConnections });

  // Load relationship context for authenticated viewers (non-blocking)
  const user = await getCurrentUser();
  if (user) {
    const { data: ctx, error: ctxErr } = await supabase.rpc("get_relationship_context", {
      p_other_profile_id: profileId,
    });
    if (!ctxErr && ctx) renderRelationshipContext(ctx, { relationshipMode: fromConnections });

    if (fromConnections) {
      // Swap app-install CTAs for a back link when arriving from the connections list.
      // Use style.display rather than .hidden because .btn { display: inline-block }
      // has higher specificity than the UA [hidden] attribute rule.
      const backBtn    = document.getElementById("profileBackBtn");
      const openBtn    = document.getElementById("profileOpenAppBtn");
      const getAppLink = document.getElementById("profileGetAppLink");
      const fallback   = document.getElementById("profileGetAppFallback");
      if (backBtn)    backBtn.style.display    = "";          // show (was hidden attr)
      if (openBtn)    openBtn.style.display    = "none";
      if (getAppLink) getAppLink.style.display = "none";
      if (fallback)   fallback.style.display   = "none";
      if (backBtn)    backBtn.removeAttribute("hidden");
    }
  }
}

init();
