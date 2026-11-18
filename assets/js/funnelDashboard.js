import { supabase } from "./supabaseClient.js";
import { resolveAdminAccess } from "./adminAccess.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const STAGES = [
  { key: "meetup_handoff_view",        label: "Page Views",        color: "#30d158" },
  { key: "enter_live_network_clicked", label: "CTA Clicks",        color: "#0a84ff" },
  { key: "testflight_clicked",         label: "Installs (TF)",     color: "#ff9f0a" },
  { key: "guest_session_created",      label: "Guest Sessions",    color: "#bf5af2" },
  { key: "app_deep_link_clicked",      label: "App Opens",         color: "#64d2ff" },
];

const STAGE_KEYS  = STAGES.map(s => s.key);


// ── State ──────────────────────────────────────────────────────────────────────

let activeRangeDays = 7;  // 0 = all time

// ── DOM refs ───────────────────────────────────────────────────────────────────

const $gate      = document.getElementById("fdAuthGate");
const $content   = document.getElementById("fdContent");
const $signIn    = document.getElementById("fdSignInBtn");
const $signOut   = document.getElementById("fdSignOutBtn");
const $userEmail = document.getElementById("fdUserEmail");
const $loading   = document.getElementById("fdLoading");
const $error     = document.getElementById("fdError");
const $stats     = document.getElementById("fdStatsSection");
const $funnel    = document.getElementById("fdFunnelSection");
const $events    = document.getElementById("fdEventsSection");
const $activity  = document.getElementById("fdActivitySection");
const $insight   = document.getElementById("fdInsight");
const $landing   = document.getElementById("fdLandingSection");
const $landingBody = document.getElementById("fdLandingBody");

// ── Auth ───────────────────────────────────────────────────────────────────────

const $restricted = document.getElementById("fdRestricted");

supabase.auth.onAuthStateChange((_event, session) => {
  const user = session?.user ?? null;
  resolveAdminAccess(supabase, session, {
    gateEl:       $gate,
    contentEl:    $content,
    restrictedEl: $restricted,
  }).then((result) => {
    if (result === "granted") {
      $content.style.display = "block"; // override #fdContent { display:none } CSS rule
      $userEmail.textContent = user?.email ?? "";
      loadData();
    }
    // Override gate display style to match the existing flex layout
    if (result === "unauthenticated") $gate.style.display = "flex";
  });
});

$signIn.addEventListener("click", () => {
  supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href },
  });
});

$signOut.addEventListener("click", () => {
  supabase.auth.signOut();
});

// ── Date filter tabs ───────────────────────────────────────────────────────────

document.querySelectorAll(".fd-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".fd-filter-btn").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeRangeDays = parseInt(btn.dataset.range, 10);
    loadData();
  });
});

// ── Data loading ───────────────────────────────────────────────────────────────

async function loadData() {
  setLoading(true);
  clearError();

  const sinceTs = activeRangeDays === 0
    ? new Date(0).toISOString()
    : new Date(Date.now() - activeRangeDays * 86400_000).toISOString();

  const [funnelResult, activityResult, landingResult] = await Promise.all([
    supabase.rpc("get_meetup_funnel", { p_since: sinceTs }),
    supabase.rpc("get_meetup_activity_hourly", { p_hours: Math.max(activeRangeDays, 1) * 24 || 8760 }),
    supabase.rpc("get_landing_demo_funnel", { p_since: sinceTs }),
  ]);

  // Independent of the Meetup funnel: a missing function must not hide the rest.
  renderLandingDemo(landingResult);

  setLoading(false);

  if (funnelResult.error) {
    showError("Failed to load funnel data: " + funnelResult.error.message);
    return;
  }

  const rows        = funnelResult.data  ?? [];
  const hourlyRows  = activityResult.data ?? [];

  const pivot = buildPivot(rows);
  const totals = buildTotals(rows);

  renderStats(totals);
  renderInsights(totals);
  renderFunnelBars(totals);
  renderEventsTable(pivot);
  renderSparkline(hourlyRows);
}

function setLoading(on) {
  $loading.style.display  = on ? "block"  : "none";
  $stats.style.display    = on ? "none"   : "grid";
  $funnel.style.display   = on ? "none"   : "block";
  $events.style.display   = on ? "none"   : "block";
  $activity.style.display = on ? "none"   : "block";
  if (on) $insight.style.display = "none";
}

function showError(msg) {
  $error.textContent    = msg;
  $error.style.display  = "block";
}
function clearError() {
  $error.style.display  = "none";
  $error.textContent    = "";
}

// ── Data processing ────────────────────────────────────────────────────────────

// Returns { [eventId]: { title, sourceEventId, stages: { [stage]: cnt } } }
function buildPivot(rows) {
  const pivot = {};
  for (const row of rows) {
    const key = row.event_id ?? "__unknown__";
    if (!pivot[key]) {
      pivot[key] = {
        eventId:       row.event_id,
        title:         row.event_title ?? "Untitled Event",
        sourceEventId: row.source_event_id ?? "—",
        stages:        {},
        latestAt:      null,
      };
    }
    pivot[key].stages[row.funnel_stage] = Number(row.cnt);
    if (!pivot[key].latestAt || row.latest_at > pivot[key].latestAt) {
      pivot[key].latestAt = row.latest_at;
    }
  }
  return pivot;
}

// Returns { [stageKey]: totalCount }
function buildTotals(rows) {
  const totals = Object.fromEntries(STAGE_KEYS.map(k => [k, 0]));
  for (const row of rows) {
    if (totals[row.funnel_stage] !== undefined) {
      totals[row.funnel_stage] += Number(row.cnt);
    }
  }
  return totals;
}

// ── Render: stat cards ─────────────────────────────────────────────────────────

// Counts are independently tracked events, not a sequential user cohort.
// Direct guest joins do not require the Meetup CTA or TestFlight.
function renderStats(totals) {
  const cards = [
    { key: "meetup_handoff_view", label: "Handoff Page Views", info: "Recorded loads of the Meetup handoff page; not all event traffic." },
    { key: "guest_session_created", label: "Guest Sessions", info: "Recorded guest-session creation events, including direct joins. Not necessarily unique people." },
    { key: "enter_live_network_clicked", label: "Handoff CTA Clicks", info: "Clicks tracked on the Meetup handoff page only; direct joins may bypass this." },
    { key: "testflight_clicked", label: "TestFlight Link Clicks", info: "Clicks on TestFlight links, not verified app installations." },
    { key: "app_deep_link_clicked", label: "Open-in-App Clicks", info: "Tracked deep-link button clicks, not verified native app launches." },
  ];
  $stats.innerHTML = cards.map(c => `
    <div class="fd-stat-card">
      <div class="fd-stat-label">${c.label}
        <span class="fd-info-icon">?<span class="fd-tooltip">${c.info}</span></span>
      </div>
      <div class="fd-stat-value">${fmt(totals[c.key] || 0)}</div>
      <div class="fd-stat-sub">Tracked events · not unique users</div>
    </div>
  `).join("");
}

// ── Homepage demo ──────────────────────────────────────────────────────────────

const LANDING_STEPS = [
  { key: "landing_view",             label: "Homepage visits" },
  { key: "landing_demo_started",     label: "Saved Maya" },
  { key: "landing_demo_completed",   label: "Saw the reminder" },
  { key: "landing_demo_cta_clicked", label: "Tapped “Save a real person”" },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderLandingDemo(result) {
  if (!$landing) return;
  $landing.style.display = "block";
  if (result.error) {
    const note = el("p", "fd-section-subtitle", "Not available yet. Run ");
    note.append(el("code", "", "supabase/migrations/20261118_landing_demo_funnel.sql"), " to turn on this report.");
    $landingBody.replaceChildren(note);
    return;
  }
  const rows = result.data ?? [];
  const totals = {};
  const sources = {};
  for (const row of rows) {
    totals[row.funnel_stage] = (totals[row.funnel_stage] || 0) + Number(row.cnt);
    if (row.funnel_stage === "landing_view") {
      sources[row.referrer_origin] = (sources[row.referrer_origin] || 0) + Number(row.cnt);
    }
  }
  const views = totals.landing_view || 0;
  const started = totals.landing_demo_started || 0;
  const finished = totals.landing_demo_completed || 0;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) + "%" : "—");

  const grid = el("div", "fd-stat-grid");
  for (const step of LANDING_STEPS) {
    const count = totals[step.key] || 0;
    const card = el("div", "fd-stat-card");
    card.append(
      el("div", "fd-stat-label", step.label),
      el("div", "fd-stat-value", fmt(count)),
      el("div", "fd-stat-sub", step.key === "landing_view" ? "Page loads" : pct(count, views) + " of visits"),
    );
    grid.append(card);
  }

  const summary = el("p", "fd-section-subtitle", started
    ? `${pct(finished, started)} of people who started the demo reached the reminder.`
    : "No demo starts in this range yet.");

  const nodes = [grid, summary];
  const topSources = Object.entries(sources).sort((x, y) => y[1] - x[1]).slice(0, 5);
  if (topSources.length) {
    const list = el("ul", "fd-section-subtitle");
    for (const [origin, n] of topSources) list.append(el("li", "", `${origin}: ${fmt(n)}`));
    nodes.push(el("div", "fd-section-subtitle", "Where visits came from:"), list);
  }
  $landingBody.replaceChildren(...nodes);
}

// Independent event totals cannot support stage-to-stage drop-off claims.
function renderInsights(totals) {
  $insight.innerHTML = `<div class="fd-insight-label">Tracking context</div>
    Guest sessions can be created through direct event joins without a tracked
    handoff CTA or TestFlight click. These figures are independent event counts,
    not a sequential conversion funnel. A zero for Open-in-App clicks does not
    mean the native app was never opened. Reliable conversion rates require
    visitor/session-level attribution.`;
  $insight.style.display = "block";
}

function renderFunnelBars(totals) {
  const maxCount = Math.max(1, ...STAGE_KEYS.map(k => totals[k] || 0));
  const $list = document.getElementById("fdFunnelList");
  if (STAGE_KEYS.every(k => !totals[k])) {
    $list.innerHTML = '<div class="fd-empty">No data for this period.</div>';
    return;
  }
  $list.innerHTML = STAGES.map(stage => {
    const count = totals[stage.key] || 0;
    const widthPct = (count / maxCount * 100).toFixed(1);
    return `<div class="fd-funnel-row">
      <div class="fd-funnel-row-header">
        <span class="fd-funnel-stage-name">${stage.label}</span>
        <span class="fd-funnel-count">${fmt(count)}</span>
      </div>
      <div class="fd-bar-track">
        <div class="fd-bar-fill" style="width:${widthPct}%; background:${stage.color};"></div>
      </div>
    </div>`;
  }).join("");
}

// ── Render: per-event table ────────────────────────────────────────────────────

function renderEventsTable(pivot) {
  const $body = document.getElementById("fdEventsBody");
  const entries = Object.values(pivot);

  if (entries.length === 0) {
    $body.innerHTML = `<tr><td colspan="8" class="fd-empty">No events found.</td></tr>`;
    return;
  }

  // Sort by views descending
  entries.sort((a, b) => (b.stages["meetup_handoff_view"] || 0) - (a.stages["meetup_handoff_view"] || 0));

  $body.innerHTML = entries.map(ev => {
    const views    = ev.stages["meetup_handoff_view"]        || 0;
    const clicks   = ev.stages["enter_live_network_clicked"] || 0;
    const installs = ev.stages["testflight_clicked"]         || 0;
    const sessions = ev.stages["guest_session_created"]      || 0;
    const opens    = ev.stages["app_deep_link_clicked"]      || 0;
    const conv     = "—"; // Cannot attribute independent event counts to a cohort.

    return `
      <tr>
        <td><div class="fd-table-event-title" title="${esc(ev.title)}">${esc(ev.title)}</div></td>
        <td class="fd-table-muted" style="font-size:12px;">${esc(ev.sourceEventId)}</td>
        <td class="fd-table-num">${fmt(views)}</td>
        <td class="fd-table-num">${fmt(clicks)}</td>
        <td class="fd-table-num">${fmt(installs)}</td>
        <td class="fd-table-num">${fmt(sessions)}</td>
        <td class="fd-table-num">${fmt(opens)}</td>
        <td class="fd-table-num fd-table-pct">${conv}</td>
      </tr>
    `;
  }).join("");
}

// ── Render: hourly sparkline ───────────────────────────────────────────────────

function renderSparkline(hourlyRows) {
  const $legend = document.getElementById("fdSparkLegend");
  const $bars   = document.getElementById("fdSparkBars");

  if (hourlyRows.length === 0) {
    $bars.innerHTML   = '<div class="fd-empty" style="width:100%;">No activity data.</div>';
    $legend.innerHTML = "";
    return;
  }

  // Build legend
  $legend.innerHTML = STAGES.map(s => `
    <div class="fd-spark-legend-item">
      <div class="fd-spark-dot" style="background:${s.color};"></div>
      ${s.label}
    </div>
  `).join("");

  // Bucket rows by hour → { hour: { stageKey: cnt } }
  const buckets = {};
  for (const row of hourlyRows) {
    const h = row.hour_bucket;
    if (!buckets[h]) buckets[h] = {};
    buckets[h][row.funnel_stage] = (buckets[h][row.funnel_stage] || 0) + Number(row.cnt);
  }

  const hours = Object.keys(buckets).sort();
  // Max total height for scaling
  let maxSum = 0;
  for (const h of hours) {
    const sum = STAGE_KEYS.reduce((s, k) => s + (buckets[h][k] || 0), 0);
    if (sum > maxSum) maxSum = sum;
  }

  // Limit to last 48 columns for readability
  const visibleHours = hours.slice(-48);

  $bars.innerHTML = visibleHours.map(h => {
    const segs = STAGES.map(stage => {
      const cnt = buckets[h][stage.key] || 0;
      const heightPct = maxSum > 0 ? (cnt / maxSum * 100).toFixed(1) : 0;
      return `<div class="fd-spark-seg" style="background:${stage.color}; height:${heightPct}%;"></div>`;
    }).join("");
    return `<div class="fd-spark-col" title="${h}">${segs}</div>`;
  }).join("");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n === 0) return "0";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function pct(num, den) {
  if (!den) return "—";
  return ((num / den) * 100).toFixed(1) + "% of prev";
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
