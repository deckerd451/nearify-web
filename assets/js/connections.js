import { supabase, getSessionCached } from "./supabaseClient.js";
import { escapeHtml } from "./utils.js";
import { logger } from "./logger.js";

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

function renderAvatar(name, avatarUrl) {
  if (avatarUrl) {
    return `<img class="intel-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` +
           `<span class="intel-avatar intel-avatar-placeholder" style="display:none;" aria-hidden="true">${escapeHtml(getInitials(name))}</span>`;
  }
  return `<span class="intel-avatar intel-avatar-placeholder" aria-hidden="true">${escapeHtml(getInitials(name))}</span>`;
}

function renderConnection(conn) {
  const profileUrl = `../profile.html?id=${encodeURIComponent(conn.profile_id)}&from=connections`;

  let metaParts = [];

  if (conn.first_encounter_event_name) {
    metaParts.push(`<span class="connection-row-event">Met at ${escapeHtml(conn.first_encounter_event_name)}</span>`);
  }

  if (conn.encounter_count > 1) {
    metaParts.push(`<span>${conn.encounter_count} events together</span>`);
  }

  if (conn.last_encounter_at) {
    const d = formatDate(conn.last_encounter_at);
    if (d) metaParts.push(`<span>Last seen ${escapeHtml(d)}</span>`);
  }

  const metaHtml = metaParts.length
    ? `<div class="connection-row-meta">${metaParts.join("")}</div>`
    : "";

  return `<li role="listitem">
    <a href="${escapeHtml(profileUrl)}" class="connection-row">
      ${renderAvatar(conn.name, conn.avatar_url)}
      <div class="connection-row-body">
        <div class="connection-row-name">${escapeHtml(conn.name || "Unknown")}</div>
        ${metaHtml}
      </div>
      <span class="connection-row-arrow" aria-hidden="true">›</span>
    </a>
  </li>`;
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

  const { data, error } = await supabase.rpc("get_my_connections", { p_status: "confirmed" });

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

  listEl.innerHTML = connections.map(renderConnection).join("");
  showOnly(listEl);
}

loadConnections();
