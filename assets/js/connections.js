import { supabase, getSessionCached } from "./supabaseClient.js";
import { logger } from "./logger.js";
import {
  CONNECTION_STATE,
  stateFromLabel,
  performSave,
} from "./connectionState.js";

function getInitials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day:   "numeric",
      year:  "numeric",
    });
  } catch {
    return null;
  }
}

function stateLabelText(state) {
  switch (state) {
    case CONNECTION_STATE.CONNECTED: return "Connected";
    case CONNECTION_STATE.SAVE_BACK: return "Saved you";
    case CONNECTION_STATE.SAVED:     return "Saved";
    default:                          return "";
  }
}

// Build the "Save back" control shown when the other person saved the current
// user first. Reuses the canonical confirm_relationship write path, using the
// row's own source_event_id (required, non-null on the relationships table).
function buildSaveBackControl(conn, chipEl) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "connection-save-btn btn primary";
  btn.textContent = "Save back";

  const err = document.createElement("span");
  err.className = "connection-save-error";
  err.setAttribute("role", "alert");
  err.style.display = "none";

  let inFlight = false;

  btn.addEventListener("click", async () => {
    btn.setAttribute("aria-busy", "true");
    btn.textContent = "Saving…";
    err.style.display = "none";
    err.textContent = "";

    const outcome = await performSave({
      supabase,
      otherProfileId: conn.profile_id,
      eventId: conn.source_event_id,
      isInFlight: () => inFlight,
      setInFlight: (v) => {
        inFlight = v;
        btn.disabled = v;   // prevent double submission
      },
    });

    if (outcome.blocked) return;

    if (!outcome.ok) {
      logger.warn("[Connections] Save back failed:", outcome.error?.message || outcome.error);
      btn.removeAttribute("aria-busy");
      btn.textContent = "Save back";
      err.textContent = "Couldn't save — try again.";
      err.style.display = "";
      return;
    }

    if (chipEl) chipEl.textContent = stateLabelText(outcome.state) || "Saved";
    btn.replaceWith(document.createTextNode(""));
  });

  const wrap = document.createElement("div");
  wrap.className = "connection-save-back";
  wrap.appendChild(btn);
  wrap.appendChild(err);
  return wrap;
}

function buildAvatarNode(name, avatarUrl) {
  const initials = getInitials(name);
  if (avatarUrl) {
    const wrap = document.createDocumentFragment();
    const img = document.createElement("img");
    img.className = "intel-avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.loading = "lazy";
    const placeholder = document.createElement("span");
    placeholder.className = "intel-avatar intel-avatar-placeholder";
    placeholder.style.display = "none";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = initials;
    // Fallback: if the image fails, hide it and reveal the initials placeholder.
    img.addEventListener("error", () => {
      img.style.display = "none";
      placeholder.style.display = "flex";
    });
    wrap.appendChild(img);
    wrap.appendChild(placeholder);
    return wrap;
  }
  const placeholder = document.createElement("span");
  placeholder.className = "intel-avatar intel-avatar-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.textContent = initials;
  return placeholder;
}

function renderConnection(conn) {
  const state      = stateFromLabel(conn.relationship_label);
  const profileUrl = `/profile/${encodeURIComponent(conn.profile_id)}?from=connections`;

  const metaParts = [];
  if (conn.first_encounter_event_name) {
    metaParts.push("Met at " + conn.first_encounter_event_name);
  }
  if (conn.encounter_count > 1) {
    metaParts.push(conn.encounter_count + " events together");
  }
  if (conn.last_encounter_at) {
    const d = formatDate(conn.last_encounter_at);
    if (d) metaParts.push("Last seen " + d);
  }

  const li = document.createElement("li");
  li.setAttribute("role", "listitem");

  const link = document.createElement("a");
  link.href = profileUrl;
  link.className = "connection-row";

  link.appendChild(buildAvatarNode(conn.name, conn.avatar_url));

  const body = document.createElement("div");
  body.className = "connection-row-body";
  const nameEl = document.createElement("div");
  nameEl.className = "connection-row-name";
  nameEl.textContent = conn.name || "Unknown";
  body.appendChild(nameEl);

  if (metaParts.length) {
    const metaEl = document.createElement("div");
    metaEl.className = "connection-row-meta";
    metaParts.forEach((part, i) => {
      const span = document.createElement("span");
      if (i === 0 && conn.first_encounter_event_name) {
        span.className = "connection-row-event";
      }
      span.textContent = part;
      metaEl.appendChild(span);
    });
    body.appendChild(metaEl);
  }
  link.appendChild(body);

  const arrow = document.createElement("span");
  arrow.className = "connection-row-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "›";
  link.appendChild(arrow);

  li.appendChild(link);

  const labelText = stateLabelText(state);
  if (labelText) {
    const aside = document.createElement("div");
    aside.className = "connection-row-aside";

    const chip = document.createElement("span");
    chip.className = "connection-state-chip connection-state-" + state;
    chip.textContent = labelText;
    aside.appendChild(chip);

    if (state === CONNECTION_STATE.SAVE_BACK) {
      aside.appendChild(buildSaveBackControl(conn, chip));
    }
    li.appendChild(aside);
  }

  return li;
}

async function loadConnections() {
  const loadingEl = document.getElementById("connectionsLoadingState");
  const authEl    = document.getElementById("connectionsAuthState");
  const emptyEl   = document.getElementById("connectionsEmptyState");
  const listEl    = document.getElementById("connectionsList");

  function showOnly(el) {
    [loadingEl, authEl, emptyEl, listEl].forEach((e) => {
      if (e) e.style.display = e === el ? "" : "none";
    });
  }

  const { data: { session } } = await getSessionCached();
  if (!session) {
    showOnly(authEl);
    return;
  }

  const { data, error } = await supabase.rpc("get_my_connections", { p_status: "all" });

  if (error) {
    logger.warn("[Connections] RPC error:", error.message);
    showOnly(emptyEl);
    return;
  }

  const connections = Array.isArray(data) ? data : [];

  if (connections.length === 0) {
    showOnly(emptyEl);
    return;
  }

  listEl.innerHTML = "";
  connections.forEach((conn) => listEl.appendChild(renderConnection(conn)));
  showOnly(listEl);
}

loadConnections();
