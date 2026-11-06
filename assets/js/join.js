// Render the limited Markdown used in imported event descriptions without HTML injection.
// Text stays textContent; only **bold** markers and line breaks become DOM nodes.
function renderEventDescription(target, value) {
  if (!target) return;
  const source = String(value ?? "");
  target.replaceChildren();
  const lines = source.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    if (lineIndex) target.appendChild(document.createElement("br"));
    const parts = line.split(/(\*\*[^*\n]+\*\*)/g);
    parts.forEach((part) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        target.appendChild(strong);
      } else if (part) {
        target.appendChild(document.createTextNode(part));
      }
    });
  });
}

import { supabase, createScopedSupabaseClient, getSessionCached } from "./supabaseClient.js";
import { cachedRead, dedupeRequest, logHiddenPollPause, withRetry } from "./supabaseLoad.js";
import { loadGhostSession, saveGhostSession, createGhostSession } from "./ghostSession.js";
import { computeIntentAlignment } from "./intelligence-algo.js";
import { connectGhostToProfile } from "./ghostConnection.js";
import { trackAppCtaClick, trackFunnelEvent } from "./analytics.js?v=20261105-funnel1";
import { escapeHtml, copyText } from "./utils.js";
import { logger } from "./logger.js";
import { pollingCoordinator } from "./pollingCoordinator.js";
import { createQrDecoder } from "./qrScanner.js";
import { saveAccountConnection } from "./accountConnection.js";
import { trackGuestFunnel } from "./guestFunnel.js";

const els = {
  joinKicker: document.getElementById("joinKicker"),
  joinTitle: document.getElementById("joinTitle"),
  joinDescription: document.getElementById("joinDescription"),
  joinEventMeta: document.getElementById("joinEventMeta"),
  joinSuccessBadge: document.getElementById("joinSuccessBadge"),
  joinPayloadCard: document.getElementById("joinPayloadCard"),
  payloadText: document.getElementById("payloadText"),
  joinQrBox: document.getElementById("joinQrBox"),
  joinQrCode: document.getElementById("joinQrCode"),
  joinPanelTitle: document.getElementById("joinPanelTitle"),
  joinPanelList: document.getElementById("joinPanelList"),
  joinPanelCard: document.getElementById("joinPanelCard"),
  intentStep: document.getElementById("intentStep"),
  getAppBtn: document.getElementById("getAppBtn"),
  alreadyInstalledHint: document.getElementById("alreadyInstalledHint"),
  joinBottomCta: document.getElementById("joinBottomCta"),
  joinBottomCtaTitle: document.getElementById("joinBottomCtaTitle"),
  joinBottomCtaDescription: document.getElementById("joinBottomCtaDescription"),
  joinBottomCtaButton: document.getElementById("joinBottomCtaButton"),
  joinBottomCtaHint: document.getElementById("joinBottomCtaHint"),
  ghostReturnCard: document.getElementById("ghostReturnCard"),
  ghostReturnKicker: document.getElementById("ghostReturnKicker"),
  ghostReturnTitle: document.getElementById("ghostReturnTitle"),
  ghostReturnLead: document.getElementById("ghostReturnLead"),
  ghostReturnConnections: document.getElementById("ghostReturnConnections"),
  ghostConnectionsList: document.getElementById("ghostConnectionsList"),
  ghostClaimBtn: document.getElementById("ghostClaimBtn"),
  ghostClaimStatus: document.getElementById("ghostClaimStatus"),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Set at init time; used by downstream renderers that don't receive params directly.
let isMeetupSource    = false;
let meetupSourceEventId = null;

// Guards against wiring the deep-link fallback buttons more than once per page load.
let deepLinkFallbackWired = false;

// Ghost intent set during the inline intent step; restored from localStorage on return visits.
let ghostIntentPrimary = null;

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const eventId   = params.get("event");
  const profileId = params.get("profile");
  return {
    eventId:       eventId   && UUID_RE.test(eventId)   ? eventId   : null,
    eventName:     params.get("name"),
    profileId:     profileId && UUID_RE.test(profileId) ? profileId : null,
    source:        params.get("source") || null,
    sourceEventId: params.get("source_event_id") || null,
  };
}

function applyMeetupSourceBadge() {
  const badge = document.getElementById("joinSourceBadge");
  if (!badge) return;
  badge.textContent = "From Meetup";
  show(badge);
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

function setJoinMode(mode) {
  document.body.classList.remove("join-mode-generic", "join-mode-personal-connect");
  document.body.classList.add(mode === "personal-connect" ? "join-mode-personal-connect" : "join-mode-generic");
}

async function fetchEvent(eventId) {
  logger.log("[Join] event param:", eventId);
  const { data, error } = await cachedRead(`event:${eventId}`, 120000, () =>
    withRetry("join:fetchEvent", () => supabase
      .from("events")
      .select("id, name, description, location, starts_at, ends_at, is_active, deleted_at")
      .eq("id", eventId)
      .single())
  );

  logger.log("[Join] Supabase event data:", data);
  logger.log("[Join] Supabase event error:", error);

  if (error) {
    // PGRST116 = "no rows returned" from .single() — not a fatal error, just means event doesn't exist
    if (error.code === "PGRST116") {
      return null;
    }
    throw error;
  }

  // Validate we got a real row with an id
  if (!data || !data.id) {
    logger.warn("[Join] Query returned but no valid row:", data);
    return null;
  }

  return data;
}

async function fetchPublicProfileBrief(profileId) {
  if (!profileId) return null;

  const { data, error } = await cachedRead(`profileBrief:${profileId}`, 180000, () =>
    withRetry("join:fetchPublicProfileBrief", () => supabase
      .rpc("get_public_profile_brief", { p_profile_id: profileId })
      .maybeSingle())
  );

  if (error) {
    logger.warn("[Join] Public target profile lookup failed", { profileId, error });
    return null;
  }

  if (data?.id && data?.name) {
    logger.log("[Join] Resolved public target profile", { id: data.id, name: data.name });
    return data;
  }

  logger.log("[Join] Public target profile not found, using fallback copy", { profileId });
  return null;
}

function renderEventMeta(event) {
  if (!els.joinEventMeta || !event) return;

  const bits = [document.body.classList.contains("join-mode-personal-connect") ? event.name : null, formatDateTime(event.starts_at), event.location].filter(Boolean);

  if (!bits.length) {
    hide(els.joinEventMeta);
    return;
  }

  els.joinEventMeta.innerHTML = bits
    .map((bit) => `<span class="join-meta-chip">${escapeHtml(bit)}</span>`)
    .join("");

  show(els.joinEventMeta);
}

function renderPayload(eventId) {
  const beaconUrl = `beacon://event/${eventId}`;
  setText(els.payloadText, beaconUrl);
  renderQrCode(beaconUrl);
}

function renderQrCode(value) {
  if (!els.joinQrBox || !els.joinQrCode) {
    logger.log("[Join] QR skipped: no container element");
    return;
  }
  if (!value) {
    logger.log("[Join] QR skipped: no value");
    return;
  }
  if (typeof window.QRCode !== "function") {
    logger.log("[Join] QR skipped: QRCode library not available");
    hide(els.joinQrBox);
    return;
  }

  // Ensure container is visible before QRCode renders (it needs dimensions)
  show(els.joinQrBox);
  els.joinQrCode.innerHTML = "";

  try {
    new window.QRCode(els.joinQrCode, {
      text: value,
      width: 180,
      height: 180,
    });
    logger.log("[Join] QR rendered");
  } catch (err) {
    logger.warn("[Join] QR skipped: render error", err.message);
    hide(els.joinQrBox);
  }
}

async function ensureGhostForEvent(eventId, displayName = "Guest") {
  if (!eventId) return null;

  const existing = loadGhostSession(eventId);
  if (existing?.ghostToken) {
    logger.log("[Ghost] Reusing existing ghost session", existing);
    return existing;
  }

  const created = await createGhostSession(eventId, displayName);
  logger.log("[Ghost] Created new ghost session", created);
  return created;
}

async function maybeConnectGhostToProfile(eventId, profileId) {
  if (!eventId || !profileId) return null;

  try {
    const result = await connectGhostToProfile(eventId, profileId);
    logger.log("[Ghost] Auto-connected to profile", result);
    return result;
  } catch (error) {
    logger.error("[Ghost] Auto-connect failed", error);
    return null;
  }
}

function renderGhostState(ghost) {
  if (!ghost) return;
  logger.log("[Ghost] Active session", ghost);
}

function setGhostClaimStatus(message) {
  if (!els.ghostClaimStatus) return;
  setText(els.ghostClaimStatus, message);
}

async function fetchCurrentProfileId() {
  const { data, error } = await supabase.rpc("current_profile_id");
  if (error) {
    logger.warn("[Ghost] Could not resolve current profile id", error);
    return null;
  }
  return data ?? null;
}

function getReconnectUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("ghost_reclaim", "1");
  return url.toString();
}

async function startGhostClaimAuth() {
  setGhostClaimStatus("Sign in to save who you met.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: getReconnectUrl() },
  });
  if (error) {
    logger.error("[Ghost] OAuth start failed", error);
    setGhostClaimStatus("We couldn't start sign in right now. Please try again.");
  }
}

async function fetchGhostConnectionHistory(ghost, eventId) {
  if (!ghost?.ghostId || !ghost?.ghostToken) return [];
  const scoped = createScopedSupabaseClient({ "x-ghost-token": ghost.ghostToken });

  const { data, error } = await scoped.rpc("get_ghost_connection_history", {
    p_ghost_id: ghost.ghostId,
    p_ghost_token: ghost.ghostToken,
    p_event_id: eventId,
  });

  if (error) {
    logger.warn("[Ghost] Failed to load ghost history", error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function maybeClaimGhostActivity(ghost, isClaimed) {
  if (!ghost?.ghostId || !ghost?.ghostToken) return;
  if (isClaimed) return;

  const { data: sessionData } = await getSessionCached();
  if (!sessionData?.session?.user) return;

  const profileId = await fetchCurrentProfileId();
  if (!profileId) {
    setGhostClaimStatus("You're signed in. Open the app and your profile will sync automatically.");
    return;
  }

  const scoped = createScopedSupabaseClient({ "x-ghost-token": ghost.ghostToken });
  const { data, error } = await scoped.rpc("claim_ghost_activity", {
    p_ghost_id: ghost.ghostId,
    p_profile_id: profileId,
  });

  if (error) {
    logger.warn("[Ghost] Claim RPC failed", error);
    setGhostClaimStatus("We couldn't claim this yet. Please try again.");
    return false;
  }

  logger.log("[Ghost] Claim successful", data);
  setGhostClaimStatus("This person is saved to your Nearify profile.");
  return true;
}

async function saveGhostEmail(ghost, email) {
  if (!ghost?.ghostId || !ghost?.ghostToken || !email) return;
  const { createScopedSupabaseClient } = await import("./supabaseClient.js");
  const scoped = createScopedSupabaseClient({ "x-ghost-token": ghost.ghostToken });
  await scoped.rpc("set_ghost_email", {
    p_ghost_id: ghost.ghostId,
    p_ghost_token: ghost.ghostToken,
    p_email: email,
  });
}

function showGhostEmailCapture() {
  const capture = document.getElementById("ghostEmailCapture");
  if (capture) show(capture);
  if (els.ghostClaimBtn) hide(els.ghostClaimBtn);
}

function wireEmailCapture(ghost) {
  const capture = document.getElementById("ghostEmailCapture");
  const emailInput = document.getElementById("ghostEmailInput");
  const submitBtn = document.getElementById("ghostEmailSubmit");
  const skipBtn = document.getElementById("ghostEmailSkip");

  if (!capture) return;

  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      const email = emailInput?.value?.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (emailInput) emailInput.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.classList.add("loading");
      try {
        await saveGhostEmail(ghost, email);
      } catch (err) {
        logger.warn("[Ghost] Email save failed", err);
        submitBtn.disabled = false;
        submitBtn.classList.remove("loading");
        setGhostClaimStatus("We couldn't save your email. Please try again.");
        return;
      }
      hide(capture);
      setGhostClaimStatus("Thanks — we'll send your recap after the event.");
      await startGhostClaimAuth();
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener("click", async () => {
      hide(capture);
      await startGhostClaimAuth();
    });
  }
}

function wireClaimButtons(ghost, isClaimed) {
  if (!els.ghostClaimBtn) return;

  wireEmailCapture(ghost);

  els.ghostClaimBtn.addEventListener("click", async () => {
    if (els.ghostClaimBtn.disabled) return;

    const { data: sessionData } = await getSessionCached();
    if (sessionData?.session?.user) {
      els.ghostClaimBtn.disabled = true;
      const originalLabel = els.ghostClaimBtn.textContent;
      els.ghostClaimBtn.textContent = "Saving…";
      const claimed = await maybeClaimGhostActivity(ghost, isClaimed);
      if (claimed) {
        els.ghostClaimBtn.textContent = "Saved ✓";
      } else {
        els.ghostClaimBtn.disabled = false;
        els.ghostClaimBtn.textContent = originalLabel;
      }
    } else {
      showGhostEmailCapture();
    }
  });
}

function getJoinState({ session, hasHistory, isClaimed }) {
  const state =
    !session && !hasHistory ? "ghost_single" :
    !session && hasHistory ? "ghost_returning" :
    session && isClaimed ? "claimed" :
    session ? "claiming" :
    "unknown";
  return state;
}

function renderGhostJourneyCard({ state, personName, historyRows }) {
  if (!els.ghostReturnCard) return;

  const uniqueNames = [...new Set((historyRows || []).map((row) => row?.to_profile_name).filter(Boolean))];
  if (els.ghostConnectionsList) {
    els.ghostConnectionsList.innerHTML = uniqueNames
      .slice(0, 3)
      .map((name) => `<li><span>${escapeHtml(name)}</span></li>`)
      .join("");
  }

  hide(els.ghostClaimBtn);
  hide(els.ghostReturnConnections);
  setGhostClaimStatus("");

  if (state === "ghost_single") {
    show(els.ghostReturnKicker);
    setText(els.ghostReturnKicker, "👻 Guest");
    setText(els.ghostReturnTitle, `You're connected with ${personName}`);
    setText(els.ghostReturnLead, "This person is saved temporarily. Create your profile to keep them and remember why they matter.");
    if (els.ghostClaimBtn) {
      setText(els.ghostClaimBtn, "Save this connection");
      show(els.ghostClaimBtn);
    }
    show(els.ghostReturnCard);
    return;
  }

  if (state === "ghost_returning") {
    show(els.ghostReturnKicker);
    setText(els.ghostReturnKicker, "👻 Guest");
    setText(els.ghostReturnTitle, "Welcome back");
    setText(els.ghostReturnLead, "These people are saved temporarily.");
    show(els.ghostReturnConnections);
    if (els.ghostClaimBtn) {
      setText(els.ghostClaimBtn, "Save your connections");
      show(els.ghostClaimBtn);
    }
    show(els.ghostReturnCard);
    return;
  }

  if (state === "claimed" || state === "claiming") {
    hide(els.ghostReturnKicker);
    setText(els.ghostReturnTitle, `You're connected with ${personName}`);
    setText(els.ghostReturnLead, "This person is now saved to your Nearify profile.");
    setGhostClaimStatus("✓ Saved to your network");
    show(els.ghostReturnCard);
    return;
  }

  hide(els.ghostReturnCard);
}

function wireIntentChips() {
  if (!els.intentStep) return;
  const chips = els.intentStep.querySelectorAll(".intent-chip");
  const gate = document.getElementById("intentSignInGate");
  const signInBtn = document.getElementById("intentSignInBtn");

  chips.forEach((chip) => {
    chip.setAttribute("aria-pressed", "false");
    if (!chip.hasAttribute("tabindex")) chip.setAttribute("tabindex", "0");

    const activateChip = () => {
      chips.forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-pressed", "false");
      });
      chip.classList.add("active");
      chip.setAttribute("aria-pressed", "true");
      if (gate) show(gate);
    };

    chip.addEventListener("click", activateChip);
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activateChip();
      }
    });
  });

  if (signInBtn) {
    signInBtn.addEventListener("click", async () => {
      signInBtn.disabled = true;
      signInBtn.classList.add("loading");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });
      if (error) {
        signInBtn.disabled = false;
        signInBtn.classList.remove("loading");
        signInBtn.textContent = "Sign in with Google";
      }
    });
  }
}

function showIntentStep() {
  if (!els.intentStep) return;
  show(els.intentStep);
  wireIntentChips();
}

// ── Deep link handoff ────────────────────────────────────────────────────────

function showDeepLinkFallback(eventId) {
  const fallback = document.getElementById("deepLinkFallback");
  if (!fallback) return;
  show(fallback);
  // Scroll into view so the fallback is visible no matter which button triggered it.
  setTimeout(() => fallback.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);

  if (deepLinkFallbackWired) return;
  deepLinkFallbackWired = true;

  const tfLink = document.getElementById("deepLinkTestFlightBtn");
  if (tfLink) {
    tfLink.addEventListener("click", () => {
      trackFunnelEvent("testflight_clicked", {
        eventId,
        source:        isMeetupSource ? "meetup" : null,
        sourceEventId: isMeetupSource ? meetupSourceEventId : null,
        button:        "deep_link_fallback",
      });
    });
  }

  const retryBtn = document.getElementById("deepLinkRetryBtn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      trackFunnelEvent("app_open_retry_clicked", {
        eventId,
        source:        isMeetupSource ? "meetup" : null,
        sourceEventId: isMeetupSource ? meetupSourceEventId : null,
      });
      logger.log("[Join] Retry: re-attempting deep link for event", eventId);
      window.location.href = `beacon://event/${eventId}`;
    });
  }
}

function attemptEventDeepLink(eventId, button) {
  trackFunnelEvent("app_deep_link_attempted", {
    eventId,
    source:        isMeetupSource ? "meetup" : null,
    sourceEventId: isMeetupSource ? meetupSourceEventId : null,
    button,
  });
  logger.log("[Join] Attempting event deep link:", `beacon://event/${eventId}`);
  window.location.href = `beacon://event/${eventId}`;
  setTimeout(() => {
    if (document.visibilityState === "visible") {
      trackFunnelEvent("app_deep_link_fallback_shown", {
        eventId,
        source:        isMeetupSource ? "meetup" : null,
        sourceEventId: isMeetupSource ? meetupSourceEventId : null,
      });
      logger.log("[Join] App did not open; showing fallback");
      showDeepLinkFallback(eventId);
    }
  }, 1200);
}

function renderGenericJoinUx(event, fallbackName, source) {
  setJoinMode("generic");

  const isMeetup = source === "meetup";
  const title = event?.name || fallbackName || "Join Event";

  hide(els.joinSuccessBadge);
  setText(els.joinKicker, "Join Event");

  if (isMeetup) {
    setText(els.joinTitle, "Save someone you meet at this event.");
    setText(
      els.joinDescription,
      "Join as a guest in your browser, then scan a personal Nearify QR to save someone you met."
    );
  } else {
    setText(els.joinTitle, title);
    setText(els.joinDescription, "Join in your browser. Scan a Nearify QR to save someone you meet — no app or account required.");
  }

  renderEventMeta(event);
  renderPayload(event.id);

  if (els.getAppBtn) els.getAppBtn.textContent = "Get iPhone app (optional)";
  if (els.alreadyInstalledHint) {
    els.alreadyInstalledHint.textContent = isMeetup
      ? "Already have the app? Open it to browse attendees and check in."
      : "Already installed? Open the app to browse, join, and check in (or scan the event QR code).";
  }
  const meetupInstallHint = document.getElementById("meetupInstallHint");
  if (meetupInstallHint) {
    if (isMeetup) show(meetupInstallHint); else hide(meetupInstallHint);
  }

  const panelCard = document.getElementById("joinPanelCard");
  if (panelCard) {
    if (isMeetup) panelCard.classList.add("join-panel--live");
    else panelCard.classList.remove("join-panel--live");
  }

  if (els.joinPanelTitle) {
    els.joinPanelTitle.textContent = isMeetup ? "What happens when you join" : "How it works";
  }
  if (els.joinPanelList) {
    els.joinPanelList.className = "join-steps-list";
    if (isMeetup) {
      els.joinPanelList.innerHTML = `
        <li><div class="join-step-label">Join as guest</div><div class="join-step-detail">Enter your name in the browser. No app required.</div></li>
        <li><div class="join-step-label">Meet in person</div><div class="join-step-detail">Ask someone you met for their personal Nearify QR code.</div></li>
        <li><div class="join-step-label">Save the connection</div><div class="join-step-detail">Scan their QR and sign in later to keep your connections.</div></li>
      `;
    } else {
      els.joinPanelList.innerHTML = `
        <li>
          <div class="join-step-label">Join</div>
          <div class="join-step-detail">Enter your name — no account needed.</div>
        </li>
        <li>
          <div class="join-step-label">Meet People</div>
          <div class="join-step-detail">Ask someone you meet for their Nearify QR.</div>
        </li>
        <li>
          <div class="join-step-label">Claim Connections</div>
          <div class="join-step-detail">Save a connection by scanning their QR. No app required.</div>
        </li>
      `;
    }
  }

  if (els.joinBottomCtaTitle) els.joinBottomCtaTitle.textContent = "The iPhone app is optional";
  if (els.joinBottomCtaDescription) {
    els.joinBottomCtaDescription.textContent = isMeetup
      ? "You can join as a guest in your browser. No app required."
      : "Install the app, then join and check in when you arrive (in app or via event QR).";
  }
  if (els.joinBottomCtaButton) els.joinBottomCtaButton.textContent = "Get iPhone app (optional)";
  if (els.joinBottomCtaHint) els.joinBottomCtaHint.textContent = "Already installed? Open the app to browse, join, and check in.";

  // ── CTA click tracking ──────────────────────────────────────────────────
  // Wire once per render; { once: true } prevents duplicate events on re-render.
  if (els.getAppBtn) {
    els.getAppBtn.addEventListener("click", (e) => {
      if (isMeetup) {
        // For Meetup source: attempt to open the specific event in the iOS app
        // instead of navigating directly to TestFlight.
        // Optional app link follows its TestFlight href; never force a deep link.
        trackFunnelEvent("testflight_clicked", {
          eventId: event.id, source: "meetup",
          sourceEventId: meetupSourceEventId, button: "hero_primary",
        });
      } else {
        trackFunnelEvent("testflight_clicked", {
          eventId: event.id, source: null, sourceEventId: null, button: "hero_primary",
        });
      }
    }, { once: true });
  }

  if (els.joinBottomCtaButton) {
    els.joinBottomCtaButton.addEventListener("click", (e) => {
      if (isMeetup) {
        // Optional app link follows its TestFlight href; never force a deep link.
        trackFunnelEvent("testflight_clicked", {
          eventId: event.id, source: "meetup",
          sourceEventId: meetupSourceEventId, button: "bottom_cta",
        });
      } else {
        trackFunnelEvent("testflight_clicked", {
          eventId: event.id, source: null, sourceEventId: null, button: "bottom_cta",
        });
      }
    }, { once: true });
  }

  if (isMeetup) {
    const installHintLink = document.querySelector("#meetupInstallHint a");
    if (installHintLink) {
      installHintLink.addEventListener("click", () => {
        trackFunnelEvent("testflight_clicked", {
          eventId: event.id, source: "meetup",
          sourceEventId: meetupSourceEventId, button: "install_hint",
        });
      }, { once: true });
    }
  }

  show(els.joinQrBox);
  logger.log("[Join] Rendering generic event join UX");
}

function renderPersonalConnectUx(event, targetProfile) {
  setJoinMode("personal-connect");

  const personName = targetProfile?.name || "this person";

  show(els.joinSuccessBadge);
  setText(els.joinKicker, "");
  setText(els.joinTitle, `You're connected with ${personName}`);
  setText(els.joinDescription, "This person has been saved for this event.");

  renderEventMeta(event);

  // Keep beacon payload available below for app users, but deemphasize it.
  renderPayload(event.id);

  if (els.getAppBtn) els.getAppBtn.textContent = "Continue in the app";
  if (els.alreadyInstalledHint) {
    els.alreadyInstalledHint.textContent =
      "Already installed? Open the app to explore the event and discover more people around you.";
  }

  if (els.joinPanelTitle) els.joinPanelTitle.textContent = "What happens next";
  if (els.joinPanelList) {
    els.joinPanelList.className = "join-steps-list join-steps-list--personal";
    els.joinPanelList.innerHTML = `
      <li>
        <div class="join-step-label">Your connection is already saved</div>
        <div class="join-step-detail">You don't need to repeat this step — ${escapeHtml(personName)} is now in your event network.</div>
      </li>
      <li>
        <div class="join-step-label">Set your intent</div>
        <div class="join-step-detail">Tell us what you're here to do so we can show you the right people.</div>
      </li>
      <li>
        <div class="join-step-label">Get the app to explore who's here</div>
        <div class="join-step-detail">Open Nearify to discover more attendees nearby and keep building momentum at ${escapeHtml(event?.name || "this event")}.</div>
      </li>
    `;
  }

  if (els.joinBottomCtaTitle) els.joinBottomCtaTitle.textContent = "Continue in the app";
  if (els.joinBottomCtaDescription) {
    els.joinBottomCtaDescription.textContent =
      "You're connected. Open Nearify to discover more people nearby and keep building your network.";
  }
  if (els.joinBottomCtaButton) els.joinBottomCtaButton.textContent = "Continue in the app";
  if (els.joinBottomCtaHint) {
    els.joinBottomCtaHint.textContent =
      "Already installed? Open the app to explore the event and discover more people around you.";
  }

  logger.log(`[Join] Rendering personal connect UX for ${personName}`);
}

function renderInvalidState(message) {
  setJoinMode("generic");
  hide(els.joinSuccessBadge);
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

async function renderAuthHandoff(eventId) {
  if (new URLSearchParams(window.location.search).get("web") === "1") return;
  try {
    const { data: sessionData } = await getSessionCached();
    const session = sessionData?.session;
    if (!session?.access_token) return;

    // Build deep link string manually to avoid URL constructor issues with custom schemes
    let deepLinkStr = "beacon://auth?token=" + encodeURIComponent(session.access_token) +
      "&refresh=" + encodeURIComponent(session.refresh_token);
    if (eventId) deepLinkStr += "&event=" + encodeURIComponent(eventId);

    const section = document.getElementById("authHandoffSection");
    if (!section) return;

    const openBtn = document.getElementById("authHandoffOpenBtn");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        trackAppCtaClick("join_auth_handoff_open", eventId ? { eventId } : {});
        trackFunnelEvent("app_deep_link_clicked", {
          eventId:       eventId || null,
          source:        isMeetupSource ? "meetup" : null,
          sourceEventId: isMeetupSource ? meetupSourceEventId : null,
        });
        window.location.href = deepLinkStr;
        setTimeout(() => {
          const fallback = document.getElementById("authHandoffFallback");
          if (fallback && document.visibilityState === "visible") show(fallback);
        }, 1200);
      });
    }

    // QR code for desktop users transferring session to their phone.
    // JWT tokens make the deep link string too long for QR capacity (~2953 bytes
    // at version 40 binary mode). Skip QR silently when over the threshold to
    // avoid the qrcode.js RS_BLOCK_TABLE out-of-bounds crash.
    const QR_MAX_SAFE_LENGTH = 800;
    const qrBox = document.getElementById("authHandoffQrBox");
    const qrContainer = document.getElementById("authHandoffQr");
    if (qrContainer && qrBox && deepLinkStr && typeof window.QRCode === "function"
        && deepLinkStr.length <= QR_MAX_SAFE_LENGTH) {
      try {
        show(qrBox);
        new window.QRCode(qrContainer, { text: deepLinkStr, width: 180, height: 180 });
        logger.log("[Join] QR rendered (auth handoff)");
      } catch (err) {
        logger.log("[Join] QR skipped (auth handoff):", err.message);
        hide(qrBox);
      }
    }

    show(section);
  } catch (err) {
    logger.log("[Join] auth handoff skipped:", err.message);
  }
}

// ── Claim success ─────────────────────────────────────────────────────────────

function renderClaimSuccessUx(event, claimResult) {
  setJoinMode("generic");

  // Update hero text for the claim context.
  setText(els.joinKicker, "");
  setText(els.joinTitle, event?.name || "Event");
  hide(els.joinDescription);

  // Hide all generic join UX: app install hero, payload card, side panel, bottom CTA.
  hide(document.getElementById("joinActions"));
  hide(els.joinQrBox);
  hide(els.joinPayloadCard);
  hide(els.joinBottomCta);
  hide(document.getElementById("joinSidePanel"));
  hide(els.intentStep);

  const section = document.getElementById("claimSuccessState");
  if (!section) {
    logger.warn("[GuestClaim] claimSuccessState element missing — falling back to generic UX");
    renderGenericJoinUx(event, null, null);
    return;
  }

  const count   = claimResult?.count ?? 0;
  const names   = claimResult?.names ?? [];

  const countEl   = document.getElementById("claimSuccessCount");
  const namesList = document.getElementById("claimSuccessNames");
  const noNamesEl = document.getElementById("claimSuccessNoNames");

  if (countEl) {
    const eventLabel = event?.name || "this event";
    countEl.textContent = count === 1
      ? `You connected with 1 person at ${eventLabel}.`
      : count > 1
        ? `You connected with ${count} people at ${eventLabel}.`
        : "Your event activity has been transferred to your profile.";
  }

  if (namesList) {
    const displayed = names.slice(0, 5);
    const overflow  = names.length - displayed.length;
    namesList.innerHTML = displayed
      .map((n) => `<li class="claim-success-name">${escapeHtml(n)}</li>`)
      .join("");
    if (overflow > 0) {
      namesList.innerHTML += `<li class="claim-success-name claim-success-name--more">+${overflow} more</li>`;
    }
    if (names.length > 0) show(namesList); else hide(namesList);
  }

  if (noNamesEl) {
    if (names.length === 0) show(noNamesEl); else hide(noNamesEl);
  }

  const viewNetworkBtn = document.getElementById("claimViewNetworkBtn");
  if (viewNetworkBtn) {
    // Button always routes to the connections page; no profile-specific URL needed.
    viewNetworkBtn.href = "../connections/";
    if (!claimResult?.profileId) {
      logger.warn("[GuestClaim] profileId missing; connections page will still work via session");
    }
  }

  show(section);
  logger.log("[GuestClaim] Claim success UX rendered", { count, names });
  if (!claimResult?.accountSave) trackFunnelEvent("ghost_claim_success_shown", {
    eventId: event?.id || null,
    count,
    source:  isMeetupSource ? "meetup" : null,
  });
}

function setGuestView(view) {
  document.body.dataset.guestView = view;
  for (const [id, stage] of [["guestConnectStage", "connect"], ["guestSaveConfirmation", "saved"], ["guestHistorySection", "history"]]) {
    const element = document.getElementById(id);
    if (element) element.hidden = view !== stage;
  }
  if (view !== "connect") {
    closeGuestQrScanner();
  }
  const back = document.getElementById("guestBackBtn");
  back?.setAttribute("aria-label", view === "saved" || view === "history" ? "Back to connecting" : "Back to event");
}

function wireGuestNavigation(eventId) {
  const toolbar = document.querySelector(".guest-flow-toolbar");
  if (toolbar) toolbar.hidden = false;
  setText(document.getElementById("guestFlowEventName"), els.joinTitle?.textContent || "This event");
  const back = document.getElementById("guestBackBtn");
  if (back) back.onclick = () => {
    if (["saved", "history"].includes(document.body.dataset.guestView)) {
      setGuestView("connect");
      document.getElementById("guestConnectHeading")?.focus();
    } else {
      window.location.href = `../events/event.html?id=${encodeURIComponent(eventId)}`;
    }
  };
  const viewHistory = () => {
    setGuestView("history");
    document.getElementById("guestHistoryHeading")?.focus();
  };
  for (const id of ["guestViewConnectionsBtn", "guestSavedViewBtn"]) {
    const button = document.getElementById(id);
    if (button) button.onclick = viewHistory;
  }
}

function showGuestJoinCta() {
  document.body.classList.add("guest-flow");
  hide(els.joinPayloadCard);
  hide(els.joinBottomCta);
  hide(document.getElementById("joinActions"));
  wireGuestNavigation(getQueryParams().eventId);
  showGuestForm();
}

function showGuestForm() {
  show(document.getElementById("guestJoinSection"));
  show(document.getElementById("guestForm"));
  hide(document.getElementById("guestJoinCta"));
  hide(document.getElementById("guestJoinedState"));
  setGuestView("join");
  try {
    const saved = localStorage.getItem("intent_primary");
    const goal = [...document.querySelectorAll('input[name="guestGoal"]')].find((input) => input.value === saved);
    if (goal) {
      goal.checked = true;
      const extra = goal.closest("details");
      if (extra) extra.open = true;
    }
  } catch (_) {}
}

function saveGhostFlatKeys(ghost) {
  try {
    if (ghost.ghostId) localStorage.setItem("nearify_ghost_id", ghost.ghostId);
    if (ghost.ghostToken) localStorage.setItem("nearify_ghost_token", ghost.ghostToken);
    if (ghost.eventId) localStorage.setItem("nearify_ghost_event_id", ghost.eventId);
    if (ghost.displayName) localStorage.setItem("nearify_ghost_display_name", ghost.displayName);
  } catch (_) {}
}

// Module-level cache populated once per page load when the joined state renders
let guestEventAttendees = [];
const attendeeRequestByEventId = new Map();

// The legacy anonymous roster is intentionally not queried: consent and
// event membership must be enforced server-side before any directory ships.
async function fetchGuestEventAttendees(_eventId) {
  return { attendees: [], empty: "Scan a person's Nearify QR to save them." };
}

function getAttendeeInitials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

async function loadGuestConnectionHistory() {
  const ghostId    = localStorage.getItem("nearify_ghost_id");
  const ghostToken = localStorage.getItem("nearify_ghost_token");
  const eventId    = localStorage.getItem("nearify_ghost_event_id");
  if (!ghostId || !ghostToken || !eventId) return [];

  const scoped = createScopedSupabaseClient({ "x-ghost-token": ghostToken });
  const { data, error } = await scoped.rpc("get_ghost_connection_history", {
    p_ghost_id:    ghostId,
    p_ghost_token: ghostToken,
    p_event_id:    eventId,
  });

  if (error) {
    logger.warn("[GuestConnect] Failed to load connection history", error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

function renderGuestConnectionHistory(connections) {
  const historyEl = document.getElementById("guestConnectionHistory");
  const listEl    = document.getElementById("guestConnectionList");
  if (!historyEl || !listEl) return;

  const names = [...new Set(
    connections.map((r) => r?.to_profile_name).filter(Boolean)
  )];

  const emptyStatus = document.getElementById("guestConnectStatus");
  if (emptyStatus) emptyStatus.hidden = names.length > 0;
  if (!names.length) {
    historyEl.style.display = "none";
    return;
  }

  listEl.innerHTML = names
    .map((name) => `<li>Met ${escapeHtml(name)}</li>`)
    .join("");
  historyEl.style.display = "";
}

function updateClaimButtonCount(count) {
  const btn = document.getElementById("guestClaimSignInBtn");
  if (!btn) return;
  const claimActions = btn.closest(".guest-joined-actions");
  if (claimActions) claimActions.hidden = count === 0;
  if (count > 0) {
    btn.textContent = count === 1 ? "Claim My 1 Connection" : `Claim My ${count} Connections`;
  } else {
    btn.textContent = "Claim My Connections";
  }
}

function closeSuggestions() {
  const el = document.getElementById("guestAttendeeSuggestions");
  if (el) { el.innerHTML = ""; el.style.display = "none"; }
}

function renderAttendeeSuggestions(query) {
  const listEl = document.getElementById("guestAttendeeSuggestions");
  if (!listEl) return;

  const q = query.toLowerCase().trim();
  if (!q) { closeSuggestions(); return; }

  const matches = guestEventAttendees.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);

  if (!matches.length) {
    if (guestEventAttendees.length > 0) {
      listEl.innerHTML = `<li class="guest-attendee-empty">No matching attendees.</li>`;
      listEl.style.display = "";
    } else {
      closeSuggestions();
    }
    return;
  }

  listEl.innerHTML = matches.map((a, i) => {
    const initials   = getAttendeeInitials(a.name);
    const intentText = a.intent ? a.intent.replace(/_/g, " ") : "";
    const relBadge   = a.relationshipStatus === "confirmed"
      ? `<span class="guest-attendee-rel-badge">Connected</span>`
      : a.relationshipStatus === "proposed_by_me"
        ? `<span class="guest-attendee-rel-badge">Saved</span>`
        : a.relationshipStatus === "proposed_by_them"
          ? `<span class="guest-attendee-rel-badge">Save them back</span>`
          : "";
    return `<li role="option" class="guest-attendee-option" data-idx="${i}" tabindex="0">` +
      `<span class="guest-attendee-avatar" aria-hidden="true">${escapeHtml(initials)}</span>` +
      `<span class="guest-attendee-name">${escapeHtml(a.name)}</span>` +
      (intentText ? `<span class="guest-attendee-intent">${escapeHtml(intentText)}</span>` : "") +
      relBadge +
      `</li>`;
  }).join("");

  listEl.style.display = "";

  listEl.querySelectorAll("[data-idx]").forEach((item) => {
    const attendee = matches[+item.dataset.idx];
    item.addEventListener("click",   () => handleAttendeeSelect(attendee));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleAttendeeSelect(attendee); }
    });
  });
}

async function handleAttendeeSelect(attendee) {
  const searchInput = document.getElementById("guestAttendeeSearch");
  const statusEl    = document.getElementById("guestConnectStatus");

  closeSuggestions();
  if (searchInput) searchInput.value = "";
  if (statusEl) statusEl.textContent = "";

  const ghostToken = localStorage.getItem("nearify_ghost_token");
  const eventId    = localStorage.getItem("nearify_ghost_event_id")
    || new URLSearchParams(window.location.search).get("event");

  if (attendee.relationshipStatus === "proposed_by_them") {
    if (statusEl) statusEl.textContent = `Saving ${attendee.name}…`;

    const { data: result, error } = await supabase.rpc("confirm_relationship", {
      p_other_profile_id: attendee.profileId,
      p_source_event_id:  eventId,
      p_source_intel_id:  null,
    });

    if (error) {
      logger.warn("[GuestConnect] confirm_relationship failed", error);
      if (statusEl) statusEl.textContent = `Couldn't save ${attendee.name}. Please try again.`;
      return;
    }

    attendee.relationshipStatus = result?.status === "confirmed" ? "confirmed" : "proposed_by_me";
    if (statusEl) {
      statusEl.textContent = attendee.relationshipStatus === "confirmed"
        ? `${attendee.name} is saved in My Connections.`
        : `You saved ${attendee.name} — waiting for them to save you back.`;
    }
    return;
  }

  if (!ghostToken || !eventId) {
    if (statusEl) statusEl.textContent = "Guest session missing. Please join as guest again.";
    return;
  }

  const { error } = await supabase.rpc("record_ghost_connection", {
    p_event_id:          eventId,
    p_ghost_token:       ghostToken,
    p_target_profile_id: attendee.profileId,
  });

  if (error) {
    logger.warn("[GuestConnect] record_ghost_connection failed", error);
    if (statusEl) {
      statusEl.textContent = (error.message || "").includes("Connection already exists")
        ? `You already saved an interaction with ${attendee.name}.`
        : `Connection failed: ${error.message || "Unknown error"}`;
    }
  } else {
    if (statusEl) {
      statusEl.innerHTML =
        `<strong>You met ${escapeHtml(attendee.name)} at this event.</strong>` +
        `<br><span class="guest-connect-claim-hint">You can save this interaction to your Nearify profile later.</span>`;
    }
    const connections = await loadGuestConnectionHistory();
    renderGuestConnectionHistory(connections);
    updateClaimButtonCount(connections.length);
  }
}

function wireGuestConnectSection() {
  const searchInput = document.getElementById("guestAttendeeSearch");
  if (!searchInput) return;

  searchInput.addEventListener("input", () => renderAttendeeSuggestions(searchInput.value));
  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim()) renderAttendeeSuggestions(searchInput.value);
  });

  // Close suggestions when clicking outside the search area
  document.addEventListener("click", (e) => {
    const suggestEl = document.getElementById("guestAttendeeSuggestions");
    if (suggestEl && !searchInput.contains(e.target) && !suggestEl.contains(e.target)) {
      closeSuggestions();
    }
  }, { capture: true, once: false });
}

let guestQrStream = null;
let guestQrScanActive = false;
let guestQrStarting = false;
let guestQrAttempt = 0;
let guestQrTimer = null;

function closeGuestQrScanner() {
  stopGuestQrCamera();
  const dialog = document.getElementById("guestQrScanner");
  if (dialog?.open) dialog.close();
  if (dialog) dialog.hidden = true;
  document.body.classList.remove("guest-scanning");
  document.getElementById("guestScanQrBtn")?.setAttribute("aria-expanded", "false");
}

function stopGuestQrCamera() {
  guestQrAttempt += 1;
  guestQrStarting = false;
  clearTimeout(guestQrTimer);
  guestQrTimer = null;
  guestQrScanActive = false;
  if (guestQrStream) guestQrStream.getTracks().forEach((track) => track.stop());
  guestQrStream = null;
  const video = document.getElementById("guestQrVideo");
  if (video) video.srcObject = null;
}

function guestProfileFromQr(value, eventId) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:" || url.hostname !== "nearify.org") return null;
    if (url.pathname !== "/join/" && url.pathname !== "/join") return null;
    const profile = url.searchParams.get("profile");
    const linkedEvent = url.searchParams.get("event");
    return UUID_RE.test(profile || "") && linkedEvent === eventId ? profile : null;
  } catch (_) {
    return null;
  }
}

function guestQrShareCode(value, eventId) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:" || url.hostname !== "nearify.org") return null;
    if (url.pathname !== "/join/" && url.pathname !== "/join") return null;
    const code = url.searchParams.get("guest");
    return url.searchParams.get("event") === eventId && /^[0-9a-f]{64}$/.test(code || "") ? code : null;
  } catch (_) { return null; }
}

async function loadGuestToGuestHistory(eventId) {
  const id = localStorage.getItem("nearify_ghost_id");
  const token = localStorage.getItem("nearify_ghost_token");
  if (!id || !token || !eventId) return [];
  const { data, error } = await supabase.rpc("get_my_guest_to_guest_connections", {
    p_event_id: eventId, p_ghost_id: id, p_ghost_token: token,
  });
  if (error) {
    logger.warn("[GuestQR] Guest history unavailable", error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function refreshAllGuestHistory(eventId) {
  const [profiles, guests] = await Promise.all([
    loadGuestConnectionHistory(), loadGuestToGuestHistory(eventId),
  ]);
  renderGuestConnectionHistory([
    ...profiles,
    ...guests.map((g) => ({ to_profile_name: g.guest_name + " (guest)" })),
  ]);
  updateClaimButtonCount(profiles.length + guests.length);
  return { profiles, guests };
}

function showGuestSaveConfirmation(message, { name, kind = "member" } = {}) {
  closeGuestQrScanner();
  document.body.dataset.guestSaveKind = kind;
  setText(document.getElementById("guestSaveMessage"), message);
  const displayName = name || (kind === "guest" ? "Guest connection" : "Nearify member");
  setText(document.getElementById("guestSavedName"), displayName);
  setText(document.getElementById("guestSavedAvatar"), name ? getAttendeeInitials(name) : "✓");
  setText(document.getElementById("guestSavedContext"), `Met at ${document.getElementById("guestFlowEventName")?.textContent || "this event"}`);
  setGuestView("saved");
  document.getElementById("guestSaveHeading")?.focus();
  const keep = document.getElementById("guestKeepConnectingBtn");
  if (keep) keep.onclick = () => {
    setGuestView("connect");
    document.getElementById("guestScanQrBtn")?.focus();
  };
}

let guestQrSavePending = false;
async function submitGuestQr(value, eventId, method = "link") {
  if (guestQrSavePending) return;
  guestQrSavePending = true;
  const save = document.getElementById("guestSaveQrLinkBtn");
  const confirmation = document.getElementById("guestSaveConfirmation");
  if (save) save.disabled = true;
  if (confirmation) confirmation.hidden = true;
  trackGuestFunnel("guest_connection_save_requested", eventId, { method });
  try {
    const outcome = await saveGuestQrCode(value, eventId);
    trackGuestFunnel(outcome?.ok ? "guest_connection_saved" : "guest_connection_save_failed", eventId,
      { method, connection_kind: outcome?.kind, reason: outcome?.reason || (outcome?.ok ? undefined : "request_failed") });
    return outcome?.ok === true;
  } catch (_) {
    trackGuestFunnel("guest_connection_save_failed", eventId, { method, reason: "request_failed" });
    const status = document.getElementById("guestQrStatus");
    if (status) status.textContent = "Couldn't save this connection. Check your connection and try again.";
  } finally {
    guestQrSavePending = false;
    if (save) save.disabled = false;
  }
}

async function saveGuestQrCode(value, eventId) {
  const code = guestQrShareCode(value, eventId);
  if (!code) return saveGuestQrProfile(value, eventId);
  const status = document.getElementById("guestQrStatus");
  const id = localStorage.getItem("nearify_ghost_id");
  const token = localStorage.getItem("nearify_ghost_token");
  if (!id || !token) {
    if (status) status.textContent = "Guest session missing. Join the event again.";
    return { ok: false, reason: "session_missing" };
  }
  if (status) status.textContent = "Saving guest connection…";
  const { data, error } = await supabase.rpc("save_guest_to_guest_connection", {
    p_event_id: eventId, p_from_ghost_id: id,
    p_from_ghost_token: token, p_target_share_code: code,
  });
  if (error) {
    logger.warn("[GuestQR] Save failed", { code: error.code, message: error.message, details: error.details });
    if (status) status.textContent = /Guest session not found/i.test(error.message || "") ? "Your guest session could not be verified for this event." : /Guest QR unavailable/i.test(error.message || "") ? "This QR belongs to an unavailable guest, yourself, or a different event." : "Couldn't save this guest (error " + (error.code || "unknown") + "). Please report this code.";
    return { ok: false, reason: "request_failed" };
  }
  stopGuestQrCamera();
  closeGuestQrScanner();
  try { await refreshAllGuestHistory(eventId); } catch (_) { /* A history refresh cannot undo a successful save. */ }
  if (status) status.textContent = "";
  const saved = Array.isArray(data) ? data[0] : data;
  showGuestSaveConfirmation("Saved to your guest session. Sign in to keep this connection in your Nearify account.", { name: saved?.guest_name, kind: "guest" });
  return { ok: true, kind: "guest" };
}

function wireGuestShowQr(eventId) {
  const button = document.getElementById("guestShowQrBtn");
  const panel = document.getElementById("guestMyQrPanel");
  const qr = document.getElementById("guestMyQrCode");
  const status = document.getElementById("guestMyQrStatus");
  const copy = document.getElementById("guestCopyQrBtn");
  const linkInput = document.getElementById("guestMyQrLink");
  const linkDetails = document.getElementById("guestQrLinkDetails");
  if (!button || !panel || !qr || button.dataset.wired) return;
  button.dataset.wired = "true";
  let shareUrl = "";
  const loadQr = async () => {
    if (button.disabled) return;
    panel.hidden = false;
    button.hidden = true;
    button.disabled = true;
    if (status) status.textContent = "Creating your QR…";
    try {
      const id = localStorage.getItem("nearify_ghost_id");
      const token = localStorage.getItem("nearify_ghost_token");
      if (!id || !token || !eventId) throw new Error("Guest session unavailable");
      const { data, error } = await supabase.rpc("get_my_guest_share_code", {
        p_event_id: eventId, p_ghost_id: id, p_ghost_token: token,
      });
      if (error || !/^[0-9a-f]{64}$/.test(data || "")) throw new Error("Guest QR unavailable");
      shareUrl = "https://nearify.org/join/?event=" + encodeURIComponent(eventId) + "&guest=" + encodeURIComponent(data) + "&web=1";
      if (linkInput) linkInput.value = shareUrl;
      qr.replaceChildren();
      if (typeof window.QRCode === "function") {
        new window.QRCode(qr, { text: shareUrl, width: 200, height: 200 });
        if (status) status.textContent = "";
      } else {
        if (status) status.textContent = "QR display unavailable. Copy your guest link instead.";
        if (linkDetails) linkDetails.open = true;
      }
    } catch (_) {
      if (status) status.textContent = "Couldn't load your QR. Try again when you're connected.";
      button.hidden = false;
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener("click", loadQr);
  copy?.addEventListener("click", async () => {
    if (!shareUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      if (status) status.textContent = "Guest link copied.";
    } catch (_) {
      if (linkInput) { linkInput.focus(); linkInput.select(); }
      if (status) status.textContent = "Select and copy your guest link below.";
    }
  });
  loadQr();
}

async function saveGuestQrProfile(value, eventId) {
  const status = document.getElementById("guestQrStatus");
  const profileId = guestProfileFromQr(value, eventId);
  if (!profileId) {
    if (status) status.textContent = "Use a Nearify personal QR link for this event. Other QR codes cannot be saved here.";
    return { ok: false, reason: "invalid_qr" };
  }
  stopGuestQrCamera();
  if (status) status.textContent = "Saving your connection…";
  const result = await maybeConnectGhostToProfile(eventId, profileId);
  if (!result) {
    if (status) status.textContent = "Couldn't save this connection. Check the QR and try again.";
    return { ok: false, reason: "request_failed" };
  }
  let connections = [];
  try { ({ profiles: connections } = await refreshAllGuestHistory(eventId)); } catch (_) { /* Save already succeeded. */ }
  if (status) status.textContent = "";
  const matched = connections.find((connection) => connection.to_profile_id === profileId);
  showGuestSaveConfirmation("Saved to your guest session. Sign in to keep this member connection across devices.", { name: matched?.to_profile_name || result?.to_profile_name });
  closeGuestQrScanner();
  return { ok: true, kind: "member" };
}

function wireGuestQrScanner(eventId) {
  const open = document.getElementById("guestScanQrBtn");
  const panel = document.getElementById("guestQrScanner");
  const video = document.getElementById("guestQrVideo");
  const status = document.getElementById("guestQrStatus");
  const stop = document.getElementById("guestStopQrBtn");
  const save = document.getElementById("guestSaveQrLinkBtn");
  const input = document.getElementById("guestQrLink");
  const fallback = document.getElementById("guestQrLinkFallback");
  if (!open || !panel || open.dataset.wired) return;
  open.dataset.wired = "true";
  const linkFallback = message => {
    if (video) video.hidden = true;
    if (stop) stop.hidden = true;
    if (status) status.textContent = message;
    if (fallback) fallback.open = true;
  };
  document.getElementById("guestCloseQrBtn")?.addEventListener("click", closeGuestQrScanner);
  panel.addEventListener("cancel", event => { event.preventDefault(); closeGuestQrScanner(); });
  panel.addEventListener("close", () => {
    if (panel.open) return;
    stopGuestQrCamera();
    panel.hidden = true;
    document.body.classList.remove("guest-scanning");
    open.setAttribute("aria-expanded", "false");
  });
  stop?.addEventListener("click", () => {
    stopGuestQrCamera();
    linkFallback("Camera stopped. Paste their Nearify link below.");
    input?.focus();
  });
  save?.addEventListener("click", () => submitGuestQr(input?.value || "", eventId, "link"));
  open.addEventListener("click", async () => {
    if (guestQrStream || guestQrStarting) return;
    if (typeof panel.showModal !== "function") {
      window.location.href = "/scan/?web=1";
      return;
    }
    panel.hidden = false;
    if (!panel.open) panel.showModal();
    document.body.classList.add("guest-scanning");
    if (fallback) fallback.open = false;
    open.setAttribute("aria-expanded", "true");
    guestQrStarting = true;
    const attempt = ++guestQrAttempt;
    trackGuestFunnel("guest_scan_requested", eventId);
    if (status) status.textContent = "Preparing your camera…";
    if (!navigator.mediaDevices?.getUserMedia) {
      guestQrStarting = false;
      trackGuestFunnel("guest_scan_failed", eventId, { reason: "camera_unavailable" });
      linkFallback("Camera unavailable in this browser. Paste their Nearify link below instead.");
      return;
    }
    let phase = "decoder";
    try {
      const decoder = await createQrDecoder();
      if (attempt !== guestQrAttempt) return;
      phase = "camera";
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (attempt !== guestQrAttempt || panel.hidden || document.body.dataset.guestView !== "connect") {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      guestQrStream = stream;
      if (video) video.hidden = false;
      if (stop) stop.hidden = false;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = stream;
      await video.play();
      if (attempt !== guestQrAttempt) return;
      guestQrScanActive = true;
      trackGuestFunnel("guest_scan_started", eventId, { decoder: decoder.kind });
      if (status) status.textContent = "Point your camera at their guest or personal Nearify QR.";
      const scan = async () => {
        if (!guestQrScanActive || attempt !== guestQrAttempt) return;
        try {
          const codes = await decoder.detect(video);
          if (!guestQrScanActive || attempt !== guestQrAttempt) return;
          if (codes[0]?.rawValue) {
            // Stop before saving: one detected code must not trigger repeated writes.
            stopGuestQrCamera();
            linkFallback("QR read. Saving your connection…");
            await submitGuestQr(codes[0].rawValue, eventId, "camera");
            return;
          }
        } catch (_) {
          if (attempt !== guestQrAttempt) return;
          stopGuestQrCamera();
          trackGuestFunnel("guest_scan_failed", eventId, { reason: "decode_failed" });
          linkFallback("Couldn't read the camera image. Try scanning again or paste their Nearify link below.");
          return;
        }
        guestQrTimer = setTimeout(scan, 250);
      };
      scan();
    } catch (error) {
      if (attempt !== guestQrAttempt) return;
      const reason = phase === "decoder" ? "decoder_unavailable"
        : error?.name === "NotAllowedError" ? "permission_denied" : "camera_unavailable";
      stopGuestQrCamera();
      trackGuestFunnel("guest_scan_failed", eventId, { reason });
      linkFallback(reason === "permission_denied"
        ? "Camera access was denied. Allow camera access in your browser settings and try again, or paste their Nearify link below."
        : "Camera unavailable. Try again or paste their Nearify link below instead.");
    } finally {
      if (attempt === guestQrAttempt) guestQrStarting = false;
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (guestQrStream || guestQrStarting)) {
      stopGuestQrCamera();
      linkFallback("Camera paused. Tap Scan someone's QR to resume, or paste their Nearify link below.");
    }
  });
  window.addEventListener("pagehide", closeGuestQrScanner);
}

function showGuestJoinedState(ghost) {
  const section = document.getElementById("guestJoinSection");
  const form = document.getElementById("guestForm");
  const joined = document.getElementById("guestJoinedState");
  const nameEl = document.getElementById("guestJoinedName");
  const cta = document.getElementById("guestJoinCta");

  document.body.classList.add("guest-flow", "guest-flow-joined");
  hide(document.getElementById("joinActions"));
  hide(els.joinPayloadCard);
  hide(els.joinBottomCta);
  saveGhostFlatKeys(ghost);

  hide(form);
  hide(cta);
  show(section);
  show(joined);
  if (nameEl) nameEl.textContent = ghost.displayName || "";
  const goal = [...document.querySelectorAll('input[name="guestGoal"]')].find((input) => input.value === ghost.intentPrimary);
  const goalLabel = goal?.dataset.label;
  setText(document.getElementById("guestJoinedGoal"), goalLabel ? `Your goal: ${goalLabel}` : "");

  const joinedLabel = joined?.querySelector(".guest-joined-label");
  if (joinedLabel) joinedLabel.textContent = "You’re in";
  wireGuestNavigation(ghost.eventId || getQueryParams().eventId);
  setGuestView("connect");

  wireGuestConnectSection();
  wireGuestQrScanner(ghost.eventId || localStorage.getItem("nearify_ghost_event_id") || new URLSearchParams(window.location.search).get("event"));
  wireGuestShowQr(ghost.eventId || localStorage.getItem("nearify_ghost_event_id") || new URLSearchParams(window.location.search).get("event"));
  wireGhostIntentChips(ghost.eventId || localStorage.getItem("nearify_ghost_event_id") || new URLSearchParams(window.location.search).get("event"));
  const scannedProfile = getQueryParams().profileId;
  const scannedEvent = getQueryParams().eventId;
  const resolvedEventId = ghost.eventId || localStorage.getItem("nearify_ghost_event_id") || scannedEvent;
  const scannedGuest = new URLSearchParams(window.location.search).get("guest");
  if (scannedGuest && scannedEvent === resolvedEventId) {
    submitGuestQr(window.location.href, resolvedEventId, "handoff").then(() => {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("guest");
      history.replaceState(null, "", clean);
    });
  } else if (scannedProfile && scannedEvent === resolvedEventId) {
    // A personal QR opened before guest registration. Record it once the
    // guest session exists; no anonymous attendee directory is queried.
    submitGuestQr(window.location.href, scannedEvent, "handoff").then(() => {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("profile");
      history.replaceState(null, "", clean);
    });
  } else {
    refreshAllGuestHistory(ghost.eventId || localStorage.getItem("nearify_ghost_event_id") || scannedEvent);
  }

  const connectEventId = ghost.eventId
    || localStorage.getItem("nearify_ghost_event_id")
    || new URLSearchParams(window.location.search).get("event");

  // Disable directory search, recommendations and intent suggestions: the
  // existing backend roster does not enforce attendee discovery consent.
  const searchWrap = document.querySelector(".guest-search-wrap");
  if (searchWrap) hide(searchWrap);
  hide(document.getElementById("ghostRecommendations"));
  hide(document.getElementById("ghostIntentStep"));
  const connectStatus = document.getElementById("guestConnectStatus");
  if (connectStatus) connectStatus.textContent = "Your saved connections will appear here.";

  // Wire the claim sign-in button every time the joined state is shown
  // (runs for both new-join and restored-session paths)
  const claimBtn = document.getElementById("guestClaimSignInBtn");
  if (claimBtn) {
    claimBtn.addEventListener("click", async () => {
      const ghostId = localStorage.getItem("nearify_ghost_id");
      const ghostToken = localStorage.getItem("nearify_ghost_token");
      const statusEl = document.getElementById("guestClaimStatus");

      if (!ghostId || !ghostToken) {
        if (statusEl) statusEl.textContent = "Guest session missing. Please join as guest again.";
        return;
      }

      trackGuestFunnel("guest_claim_started", getQueryParams().eventId);
      logger.log("[GuestClaim] Starting sign-in to claim guest session");
      localStorage.setItem("nearify_pending_ghost_claim", "true");

      claimBtn.disabled = true;
      claimBtn.textContent = "Signing in…";

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });

      if (error) {
        trackGuestFunnel("guest_claim_failed", getQueryParams().eventId, { reason: "request_failed" });
        logger.error("[GuestClaim] OAuth start failed", error);
        localStorage.removeItem("nearify_pending_ghost_claim");
        claimBtn.disabled = false;
        updateClaimButtonCount(0);
        const statusEl2 = document.getElementById("guestClaimStatus");
        if (statusEl2) statusEl2.textContent = "Sign-in failed. Please try again.";
      }
    });
  }
}

async function maybeClaimPendingGhostSession() {
  if (localStorage.getItem("nearify_pending_ghost_claim") !== "true") return null;

  logger.log("[GuestClaim] Pending claim detected after auth");

  const ghostId      = localStorage.getItem("nearify_ghost_id");
  const ghostToken   = localStorage.getItem("nearify_ghost_token");
  const ghostEventId = localStorage.getItem("nearify_ghost_event_id");
  const statusEl     = document.getElementById("guestClaimStatus");

  if (!ghostId || !ghostToken) {
    localStorage.removeItem("nearify_pending_ghost_claim");
    logger.warn("[GuestClaim] Pending claim found but ghost keys missing");
    return null;
  }

  // Read scoped session (holds intentPrimary) before any keys are cleared.
  const scopedSession = ghostEventId ? loadGhostSession(ghostEventId) : null;
  const intentPrimary = scopedSession?.intentPrimary || null;

  const { data: { session } } = await getSessionCached();
  const userId = session?.user?.id;

  console.log("[GuestClaim] Auth user id", userId);

  if (!userId) {
    logger.warn("[GuestClaim] Pending claim found but no authenticated user");
    return null;
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError || !profileData?.id) {
    trackGuestFunnel("guest_claim_failed", ghostEventId, { reason: "profile_missing" });
    logger.warn("[GuestClaim] Could not resolve profile id", profileError);
    if (statusEl) statusEl.textContent = "We couldn't find your Nearify profile after sign-in. Your guest session is still saved.";
    return null;
  }

  const profileId = profileData.id;
  console.log("[GuestClaim] Resolved profile id", profileId);

  // Fetch connection history BEFORE clearing keys — used for the success screen.
  const history      = await fetchGhostConnectionHistory({ ghostId, ghostToken }, ghostEventId);
  const { data: guestHistory, error: guestHistoryError } = await supabase.rpc("get_my_guest_to_guest_connections", {
    p_event_id: ghostEventId, p_ghost_id: ghostId, p_ghost_token: ghostToken,
  });
  if (guestHistoryError) {
    trackGuestFunnel("guest_claim_failed", ghostEventId, { reason: "history_unavailable" });
    logger.warn("[GuestClaim] Could not load guest history; preserving credentials", guestHistoryError);
    if (statusEl) statusEl.textContent = "Could not verify saved guests. Please try again.";
    return null;
  }
  const claimedNames = [...new Set([...history.map(r => r?.to_profile_name), ...(guestHistory || []).map(r => r?.guest_name)].filter(Boolean))];

  // The new RPC derives the profile from the authenticated JWT and validates
  // the private guest token itself. Guest-to-guest edges remain durable.
  const { data: claimData, error } = await supabase.rpc("claim_guest_network", {
    p_ghost_id: ghostId,
    p_ghost_token: ghostToken,
  });

  if (error) {
    trackGuestFunnel("guest_claim_failed", ghostEventId, { reason: "request_failed" });
    console.error("[GuestClaim] Claim failed", {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      status: error?.status,
      raw: JSON.stringify(error || {}, null, 2),
    });
    if (statusEl) statusEl.textContent = `We couldn't save your session: ${error?.message || "Unknown error"}. Your interactions are still saved on this device.`;
    return null;
  }

  trackGuestFunnel("guest_account_claimed", ghostEventId, {}, { once: true });
  logger.log("[GuestClaim] Claim successful", claimData);

  // Clear flat keys then scoped key.
  localStorage.removeItem("nearify_pending_ghost_claim");
  localStorage.removeItem("nearify_ghost_id");
  localStorage.removeItem("nearify_ghost_token");
  localStorage.removeItem("nearify_ghost_event_id");
  localStorage.removeItem("nearify_ghost_display_name");
  if (ghostEventId) {
    try { localStorage.removeItem(`nearify_ghost:${ghostEventId}`); } catch (_) {}
  }

  const claimBtn = document.getElementById("guestClaimSignInBtn");
  if (claimBtn) claimBtn.style.display = "none";
  if (statusEl) statusEl.textContent = "Your event history is now saved to your profile.";

  return {
    success:       true,
    count:         claimedNames.length,
    names:         claimedNames,
    intentPrimary,
    profileId,
  };
}

async function handleGuestSubmit(eventId) {
  const input = document.getElementById("guestDisplayName");
  const errorEl = document.getElementById("guestNameError");
  const statusEl = document.getElementById("guestJoinStatus");
  const submitBtn = document.getElementById("guestSubmitBtn");

  if (submitBtn?.disabled) return;
  const name = input?.value?.trim();

  if (errorEl) errorEl.style.display = "none";
  input?.removeAttribute("aria-invalid");
  if (statusEl) statusEl.textContent = "";

  if (!name) {
    if (errorEl) errorEl.style.display = "";
    input?.setAttribute("aria-invalid", "true");
    if (input) input.focus();
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Joining…";
  }

  try {
    const ghost = await createGhostSession(eventId, name);
    if (!ghost) throw new Error("create_ghost_participant returned null");
    trackGuestFunnel("guest_session_created", eventId, { source: isMeetupSource ? "meetup" : undefined }, { once: true });
    // Optional goal is a local reminder; it does not authorize roster access.
    ghostIntentPrimary = document.querySelector('input[name="guestGoal"]:checked')?.value || "meet_people";
    ghost.intentPrimary = ghostIntentPrimary;
    saveGhostSession(eventId, ghost);
    showGuestJoinedState(ghost);
    document.getElementById("guestConnectHeading")?.focus();
  } catch (err) {
    trackGuestFunnel("guest_join_failed", eventId, { reason: "request_failed" });
    logger.error("[Guest] Failed to create ghost session", err);
    if (statusEl) statusEl.textContent = "Something went wrong. Please try again.";
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Join as a guest";
    }
  }
}

// ── Ghost intent refinement ───────────────────────────────────────────────────

function wireGhostIntentChips(eventId) {
  const intentStep = document.getElementById("ghostIntentStep");
  if (!intentStep) return;

  intentStep.querySelectorAll(".ghost-intent-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const intent = chip.dataset.intent;
      ghostIntentPrimary = intent;

      const existing = loadGhostSession(eventId);
      if (existing) saveGhostSession(eventId, { ...existing, intentPrimary: intent });

      trackFunnelEvent("ghost_intent_selected", {
        eventId,
        intent,
        source: isMeetupSource ? "meetup" : null,
      });

      // Update active chip visual state
      intentStep.querySelectorAll(".ghost-intent-chip").forEach((c) => c.classList.remove("ghost-intent-chip--active"));
      chip.classList.add("ghost-intent-chip--active");

      // Re-rank recommendations in place without navigating
      if (guestEventAttendees.length > 0) {
        const recs = computeGhostRecommendations(guestEventAttendees, intent);
        renderGhostRecommendations(recs, eventId);
      }
    });
  });
}

// ── Ghost recommendations ─────────────────────────────────────────────────────

function computeGhostRecommendations(attendees, intent) {
  return attendees
    .map((a) => ({ ...a, alignScore: computeIntentAlignment(intent, a.intent) }))
    .filter((a) => a.alignScore > 0)
    .sort((a, b) => b.alignScore - a.alignScore)
    .slice(0, 3);
}

const INTENT_LABELS = {
  meet_people:    "open to conversations",
  find_cofounder: "looking for a cofounder",
  hire:           "hiring",
  explore_ideas:  "exploring ideas",
  demo:           "demoing something",
};

function recReasonText(rec) {
  if (rec.alignScore === 1) {
    const label = INTENT_LABELS[rec.intent] || rec.intent.replace(/_/g, " ");
    return `Also ${label}`;
  }
  if (rec.alignScore >= 0.6) return "Their goal complements yours";
  return "Attending this event";
}

async function handleRecConnect(btn, rec, eventId) {
  btn.disabled = true;
  btn.textContent = "Connecting…";

  trackFunnelEvent("ghost_recommendation_connect", {
    eventId,
    targetProfileId: rec.profileId,
    source: isMeetupSource ? "meetup" : null,
  });

  const ghostToken  = localStorage.getItem("nearify_ghost_token");
  const ghostEventId = localStorage.getItem("nearify_ghost_event_id") || eventId;

  const { error } = await supabase.rpc("record_ghost_connection", {
    p_event_id:          ghostEventId,
    p_ghost_token:       ghostToken,
    p_target_profile_id: rec.profileId,
  });

  if (error) {
    logger.warn("[GhostRecs] record_ghost_connection failed", error);
    btn.disabled = false;
    btn.textContent = (error.message || "").toLowerCase().includes("already") ? "Already saved" : "Connect";
  } else {
    btn.textContent = "Connected ✓";
    btn.classList.add("ghost-rec-connected");
    const statusEl = document.getElementById("guestConnectStatus");
    if (statusEl) {
      statusEl.innerHTML =
        `<strong>You met ${escapeHtml(rec.name)} at this event.</strong>` +
        `<br><span class="guest-connect-claim-hint">You can save this interaction to your Nearify profile later.</span>`;
    }
    const connections = await loadGuestConnectionHistory();
    renderGuestConnectionHistory(connections);
    updateClaimButtonCount(connections.length);
  }
}

function renderGhostRecommendations(recs, eventId) {
  const container = document.getElementById("ghostRecommendations");
  const cards     = document.getElementById("ghostRecsCards");
  if (!container || !cards) return;

  if (!recs.length) {
    hide(container);
    return;
  }

  cards.innerHTML = recs.map((rec) => {
    const initials = getAttendeeInitials(rec.name);
    const bg       = getAvatarColor(rec.name);
    return `
      <div class="ghost-rec-card">
        <div class="ghost-rec-left">
          <span class="ghost-rec-avatar" style="background:${bg};" aria-hidden="true">${escapeHtml(initials)}</span>
          <div class="ghost-rec-info">
            <span class="ghost-rec-name">${escapeHtml(rec.name)}</span>
            <span class="ghost-rec-reason">${escapeHtml(recReasonText(rec))}</span>
          </div>
        </div>
        <button class="ghost-rec-connect-btn btn secondary" data-profile-id="${escapeHtml(rec.profileId)}" type="button">Connect</button>
      </div>
    `;
  }).join("");

  cards.querySelectorAll(".ghost-rec-connect-btn").forEach((btn, i) => {
    btn.addEventListener("click", () => handleRecConnect(btn, recs[i], eventId));
  });

  show(container);

  trackFunnelEvent("ghost_recommendation_shown", {
    eventId,
    count:  recs.length,
    source: isMeetupSource ? "meetup" : null,
  });
}

function wireGuestJoinFlow(eventId) {
  const joinAsGuestBtn = document.getElementById("joinAsGuestBtn");
  const submitBtn = document.getElementById("guestSubmitBtn");
  const cancelBtn = document.getElementById("guestCancelBtn");
  const nameInput = document.getElementById("guestDisplayName");

  if (joinAsGuestBtn) {
    joinAsGuestBtn.addEventListener("click", showGuestForm);
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", () => handleGuestSubmit(eventId));
  }

  if (nameInput) {
    nameInput.addEventListener("input", () => {
      if (nameInput.value.trim()) {
        hide(document.getElementById("guestNameError"));
        nameInput.removeAttribute("aria-invalid");
      }
    });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleGuestSubmit(eventId);
      }
    });
  }

  if (cancelBtn) cancelBtn.addEventListener("click", () => {
    window.location.href = `../events/event.html?id=${encodeURIComponent(eventId)}`;
  });
  // guestClaimSignInBtn is wired inside showGuestJoinedState, not here,
  // so it fires for both new-join and restored-session paths.
}

// A locally restored session is not proof that its database row remains
// eligible for guest actions. The share-code RPC checks both credentials and
// claimed_by_profile_id, matching the guest-to-guest save preconditions.
async function initGuestJoinSection(eventId) {
  const existing = loadGhostSession(eventId);
  if (existing?.ghostId && existing?.ghostToken) {
    const { error } = await supabase.rpc("get_my_guest_share_code", {
      p_event_id: eventId,
      p_ghost_id: existing.ghostId,
      p_ghost_token: existing.ghostToken,
    });
    if (!error) {
      ghostIntentPrimary = existing.intentPrimary || "meet_people";
      showGuestJoinedState(existing);
      wireGhostIntentChips(eventId);
      logger.log("[Guest] Verified existing guest session on page load");
      return;
    }
    if (error.code === "P0001" && /Guest session not found/i.test(error.message || "")) {
      // Do not erase recovery credentials or claim history automatically.
      hide(document.getElementById("guestJoinedState"));
      hide(document.getElementById("guestForm"));
      hide(document.getElementById("guestJoinCta"));
      const section = document.getElementById("guestJoinSection");
      show(section);
      let notice = document.getElementById("guestSessionExpiredNotice");
      if (!notice) {
        notice = document.createElement("div");
        notice.id = "guestSessionExpiredNotice";
        notice.className = "guest-joined-card";
        const message = document.createElement("p");
        message.textContent = "This saved guest session is no longer active. It may already have been claimed by a Nearify account. Sign in to your account to view claimed connections, or start a new guest session for this event.";
        const restart = document.createElement("button");
        restart.type = "button";
        restart.className = "btn secondary";
        restart.textContent = "Start a new guest session";
        restart.addEventListener("click", () => {
          // Explicit choice only. Preserve old credentials for possible recovery.
          try {
            const key = "nearify_ghost:" + eventId;
            const previous = localStorage.getItem(key);
            if (previous) localStorage.setItem("nearify_previous_ghost:" + eventId, previous);
            localStorage.removeItem(key);
            localStorage.removeItem("nearify_ghost_id");
            localStorage.removeItem("nearify_ghost_token");
            localStorage.removeItem("nearify_ghost_event_id");
            localStorage.removeItem("nearify_ghost_display_name");
          } catch (e) {
            logger.warn("[Guest] Could not prepare a new guest session", e);
            return;
          }
          hide(notice);
          showGuestJoinCta();
          wireGuestJoinFlow(eventId);
        });
        notice.append(message, restart);
        section?.appendChild(notice);
      }
      show(notice);
      logger.warn("[Guest] Saved guest session no longer eligible for guest QR actions");
      return;
    }
    // Network failures and unknown RPC errors must not invalidate local state.
    logger.warn("[Guest] Could not verify saved guest session; preserving it", {
      code: error.code, message: error.message,
    });
    showGuestJoinedState(existing);
    return;
  }
  showGuestJoinCta();
  wireGuestJoinFlow(eventId);
}

// ── Meetup source enhancements ──────────────────────────────────────────────

const AVATAR_PALETTE = [
  "rgba(48,  209, 88,  0.18)",
  "rgba(10,  132, 255, 0.18)",
  "rgba(255, 159, 10,  0.18)",
  "rgba(191, 90,  242, 0.18)",
  "rgba(100, 210, 255, 0.18)",
  "rgba(255, 55,  95,  0.18)",
];

function getAvatarColor(name) {
  if (!name) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function renderLiveStatusIndicator() {
  const el = document.getElementById("liveStatusIndicator");
  if (!el) return;
  show(el);
}

function updatePanelAttendeeSignal(count, attendees) {
  const signal = document.getElementById("panelAttendeeSignal");
  const countEl = document.getElementById("panelAttendeeCount");
  if (!signal || !countEl || count <= 0) return;

  const miniStack = signal.querySelector(".panel-mini-stack");
  if (miniStack) {
    miniStack.innerHTML = (attendees || []).slice(0, 3).map((a) => {
      const initials = getAttendeeInitials(a.name);
      const bg = getAvatarColor(a.name);
      return `<span class="panel-mini-avatar" style="background:${bg};" title="${escapeHtml(a.name)}">${escapeHtml(initials)}</span>`;
    }).join("");
  }

  countEl.textContent = count === 1
    ? "1 person already in the network"
    : `${count} people already in the network`;
  show(signal);
}

function renderLiveAttendeePreview(attendees) {
  const container = document.getElementById("liveAttendeePreview");
  if (!container) return;

  const stack = container.querySelector(".live-attendee-stack");
  const label = container.querySelector(".live-attendee-label");
  const displayed = (attendees || []).slice(0, 6);

  if (stack) {
    stack.innerHTML = displayed.map((a) => {
      const initials = getAttendeeInitials(a.name);
      const bg = getAvatarColor(a.name);
      return `<span class="live-attendee-avatar" data-pid="${escapeHtml(a.profileId)}" style="background:${bg};" title="${escapeHtml(a.name)}">${escapeHtml(initials)}</span>`;
    }).join("");
  }

  if (label) {
    if (!displayed.length) {
      label.textContent = "Be one of the first people joining this event.";
    } else {
      const count = displayed.length;
      label.textContent = count === 1
        ? "1 person is joining this event."
        : `${count} people are joining this event.`;
    }
  }

  show(container);
  updatePanelAttendeeSignal(displayed.length, displayed);
}

// ── Live presence polling ────────────────────────────────────────────────────

let livePollingEventId = null;
let lastKnownAttendees = [];    // seeded from initial fetch
let pollingInFlight    = false;
const LIVE_ATTENDEE_POLL_KEY = "join:live-attendees";

// Activity message queue — one message visible at a time, never spam.
let activityQueue    = [];
let activityDraining = false;

async function pollLiveAttendees(eventId) {
  const { attendees } = await fetchGuestEventAttendees(eventId);
  if (!attendees.length) return;

  const existingIds = new Set(lastKnownAttendees.map((a) => a.profileId));
  const newOnes     = attendees.filter((a) => !existingIds.has(a.profileId));
  const wasEmpty    = lastKnownAttendees.length === 0;

  if (newOnes.length > 0 || wasEmpty) {
    patchLiveAttendeePreview(attendees, newOnes, wasEmpty);
    if (newOnes.length > 0) {
      pulseStatusDot();
      enqueueActivity(newOnes, wasEmpty);
    }
  }

  lastKnownAttendees = attendees.slice();
}

function startLivePolling(eventId) {
  if (!eventId) return;
  if (livePollingEventId === eventId) {
    logger.log("[SupabaseLoad] attendee poll duplicate blocked", { eventId });
    return;
  }
  livePollingEventId = eventId;
  pollingCoordinator.register({
    key: LIVE_ATTENDEE_POLL_KEY,
    intervalMs: 30000,
    jitterMs: 5000,
    immediate: false,
    run: async () => {
      if (!livePollingEventId || pollingInFlight) return;
      pollingInFlight = true;
      try {
        await pollLiveAttendees(livePollingEventId);
      } finally {
        pollingInFlight = false;
      }
    },
  });
  logger.log("[SupabaseLoad] attendee poll started", { eventId });
}

function stopLivePolling() {
  livePollingEventId = null;
  pollingCoordinator.stop(LIVE_ATTENDEE_POLL_KEY);
  logger.log("[SupabaseLoad] attendee poll stopped");
}

function patchLiveAttendeePreview(attendees, newOnes, wasEmpty) {
  const container = document.getElementById("liveAttendeePreview");
  if (!container) return;

  const stack = container.querySelector(".live-attendee-stack");
  const label = container.querySelector(".live-attendee-label");

  if (stack) {
    const existingIds = new Set(
      [...stack.querySelectorAll("[data-pid]")].map(el => el.dataset.pid)
    );
    const slots  = Math.max(0, 6 - existingIds.size);
    const toAdd  = newOnes.filter(a => !existingIds.has(a.profileId)).slice(0, slots);

    for (const a of toAdd) {
      const span = document.createElement("span");
      span.className = "live-attendee-avatar is-entering";
      span.style.background = getAvatarColor(a.name);
      span.dataset.pid = a.profileId;
      span.title = a.name;
      span.textContent = getAttendeeInitials(a.name);
      stack.appendChild(span);
      span.addEventListener("animationend", () => span.classList.remove("is-entering"), { once: true });
    }
  }

  if (label) {
    const total = attendees.length;
    label.textContent = total === 1
      ? "1 person is joining this event."
      : `${total} people are joining this event.`;
  }

  if (wasEmpty) {
    container.classList.add("is-activating");
    container.addEventListener("animationend", () => container.classList.remove("is-activating"), { once: true });
  }

  updatePanelAttendeeSignal(attendees.length, attendees.slice(0, 6));
}

function pulseStatusDot() {
  const dot = document.querySelector(".live-status-dot");
  if (!dot) return;
  dot.classList.remove("is-bursting");
  void dot.offsetWidth; // force reflow so re-adding class re-triggers animation
  dot.classList.add("is-bursting");
  dot.addEventListener("animationend", () => dot.classList.remove("is-bursting"), { once: true });
}

function enqueueActivity(newOnes, wasEmpty) {
  let msg;
  if (wasEmpty) {
    msg = "The network for this event is now active.";
  } else if (newOnes.length === 1) {
    const firstName = newOnes[0].name.trim().split(/\s+/)[0];
    msg = `${firstName} just joined the live network.`;
  } else if (newOnes.length <= 4) {
    msg = `${newOnes.length} more people just joined.`;
  } else {
    msg = "Several more people just joined.";
  }
  activityQueue.push(msg);
  if (!activityDraining) drainActivityQueue();
}

function drainActivityQueue() {
  if (!activityQueue.length) { activityDraining = false; return; }
  activityDraining = true;
  showActivityMessage(activityQueue.shift());
}

function showActivityMessage(text) {
  const feed = document.getElementById("liveActivityFeed");
  if (!feed) { drainActivityQueue(); return; }

  feed.innerHTML = "";
  const p = document.createElement("p");
  p.className = "live-activity-msg";
  p.textContent = text;
  feed.appendChild(p);

  setTimeout(() => {
    p.classList.add("is-exiting");
    setTimeout(() => {
      if (feed.contains(p)) feed.innerHTML = "";
      drainActivityQueue();
    }, 600);
  }, 3500);
}

function clearGhostSession() {
  try {
    localStorage.removeItem("nearify_ghost_id");
    localStorage.removeItem("nearify_ghost_token");
    localStorage.removeItem("nearify_ghost_event_id");
    localStorage.removeItem("nearify_ghost_display_name");
    localStorage.removeItem("nearify_pending_ghost_claim");
  } catch (_) {}
}

// Called for authenticated users who may have a ghost session in localStorage
// from a previous unauthenticated visit. Silently attempts to claim and then
// always clears the ghost keys so the guest UI is never shown to auth users.
async function maybeAutoClaimGhostForAuthenticatedUser(eventId) {
  const ghostId    = localStorage.getItem("nearify_ghost_id");
  const ghostToken = localStorage.getItem("nearify_ghost_token");
  if (!ghostId || !ghostToken) return;

  logger.log("[Ghost] Authenticated user has ghost session — attempting auto-claim");

  const { data: { session } } = await getSessionCached();
  // Keep guest recovery credentials if authentication is temporarily unavailable.
  // Clearing here would make an unclaimed connection unrecoverable on this device.
  if (!session?.user?.id) return;

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const profileId = profileData?.id;
  if (!profileId) {
    logger.warn("[Ghost] Auto-claim: no profile found for authenticated user");
    // Profile creation may still be in progress; preserve guest state for retry.
    return;
  }

  const { error } = await supabase.rpc("claim_guest_network", {
    p_ghost_id: ghostId,
    p_ghost_token: ghostToken,
  });

  if (error) {
    logger.warn("[Ghost] Auto-claim failed; guest activity retained for retry", error.message);
    return;
  }

  trackGuestFunnel("guest_account_claimed", eventId, {}, { once: true });
  logger.log("[Ghost] Auto-claim succeeded");
  const ghostEventId = localStorage.getItem("nearify_ghost_event_id") || eventId;
  clearGhostSession();
  try { localStorage.removeItem(`nearify_ghost:${ghostEventId}`); } catch (_) {}
}

function renderWebScanFailure(message, { title = "Connection needs another try", retry = true } = {}) {
  document.body.classList.add("web-browser-flow");
  renderInvalidState(message);
  setText(els.joinTitle, title);
  if (retry) {
    const button = document.createElement("button");
    button.id = "webScanRetryBtn";
    button.className = "btn primary";
    button.textContent = "Try again";
    button.addEventListener("click", () => window.location.reload());
    els.joinDescription?.after(button);
  }
  const scan = document.createElement("a");
  scan.id = "scanAnotherQr";
  scan.href = "/scan/?web=1";
  scan.className = retry ? "btn secondary" : "btn primary";
  scan.textContent = "Scan someone else's QR";
  els.joinDescription?.after(scan);
}

async function saveSignedInGuestQr(event, code) {
  if (!/^[0-9a-f]{64}$/.test(code)) {
    renderWebScanFailure("This guest QR is invalid. Ask them to show their Nearify QR again.");
    return;
  }
  try {
    const ghost = await ensureGhostForEvent(event.id);
    saveGhostFlatKeys(ghost);
    const { error } = await supabase.rpc("save_guest_to_guest_connection", {
      p_event_id: event.id, p_from_ghost_id: ghost.ghostId,
      p_from_ghost_token: ghost.ghostToken, p_target_share_code: code,
    });
    if (error) {
      renderWebScanFailure("Could not save this guest. Their QR may belong to a different event or may no longer be available.");
      return;
    }
    // Preserve credentials on claim failure so a successful guest save is recoverable.
    localStorage.setItem("nearify_pending_ghost_claim", "true");
    const claimed = await maybeClaimPendingGhostSession();
    if (!claimed?.success) {
      renderWebScanFailure("The connection was saved to this browser session, but account transfer needs another try. Keep using this browser and try again.");
      return;
    }
    renderClaimSuccessUx(event, claimed);
    const clean = new URL(window.location.href);
    clean.searchParams.delete("guest");
    window.history.replaceState(null, "", clean);
  } catch (_) {
    renderWebScanFailure("Could not finish saving this connection. Keep this browser session and try again when connected.");
  }
}

async function initJoinPage() {
  const { eventId, eventName, profileId, source, sourceEventId } = getQueryParams();
  const requestedWeb = new URLSearchParams(window.location.search).get("web") === "1";
  if (requestedWeb) document.body.classList.add("web-browser-flow");

  isMeetupSource    = source === "meetup";
  meetupSourceEventId = isMeetupSource ? (sourceEventId || null) : null;
  if (isMeetupSource) {
    applyMeetupSourceBadge();
    logger.log("[Join] Meetup source handoff detected", { sourceEventId });
  }

  logger.log("[Join] raw URL:", window.location.href);

  if (!eventId) {
    renderInvalidState("This link is missing an event id.");
    return;
  }

  try {
    const [event, targetProfile] = await Promise.all([
      fetchEvent(eventId),
      profileId ? fetchPublicProfileBrief(profileId) : Promise.resolve(null),
    ]);

    if (!event) {
      logger.warn("[Join] No event row found for id:", eventId);
      renderInvalidState("No event found with this ID.");
      return;
    }

    if (event.is_active === false) {
      logger.warn("[Join] Event is inactive:", eventId);
      renderInvalidState("This event is no longer active.");
      return;
    }

    if (event.deleted_at) {
      logger.warn("[Join] Event is archived:", eventId);
      renderInvalidState("This event has been archived.");
      return;
    }

    // Resolve auth session before branching — determines which experience to render.
    const { data: sessionData } = await getSessionCached();
    const hasSession    = !!sessionData?.session?.user;
    const isPendingClaim = localStorage.getItem("nearify_pending_ghost_claim") === "true";

    const scannedGuest = new URLSearchParams(window.location.search).get("guest");
    if (hasSession && scannedGuest) {
      await saveSignedInGuestQr(event, scannedGuest);
      return;
    }
    if (hasSession && requestedWeb && !profileId && !isPendingClaim) {
      window.location.replace(`/events/event.html?id=${encodeURIComponent(event.id)}&web=1`);
      return;
    }
    if (profileId && hasSession) {
      const saved = await saveAccountConnection(supabase, event.id, profileId);
      if (!saved.ok) {
        renderWebScanFailure(saved.reason === "self"
          ? "You're signed in as the person on this QR. Scan someone else's QR to save a connection."
          : saved.reason === "profile_missing"
            ? "We couldn't find your Nearify profile. Finish setting up your account, then try again."
            : "We couldn't save this connection to your account. Please try again.",
          { title: saved.reason === "self" ? "This is your QR" : "Connection needs another try", retry: saved.reason !== "self" });
        return;
      }
      renderClaimSuccessUx(event, {count:1,names:targetProfile?.name ? [targetProfile.name] : [],profileId:saved.profileId,accountSave:true});
      setText(document.getElementById("claimSuccessCount"), `Saved at ${event.name || "this event"}.`);
      setText(document.getElementById("claimSuccessNoNames"), "This person is saved to your Nearify account.");
      setText(document.querySelector(".claim-success-title"), saved.status === "confirmed" ? "You're connected" : "Connection saved");
      setText(document.querySelector(".claim-success-profile-msg"), saved.status === "confirmed"
        ? "You have both saved this connection."
        : "Saved to your Nearify account. This becomes a mutual connection if they save you back.");
      const actions = document.querySelector(".claim-success-actions");
      const scan = document.createElement("a");
      scan.href = "/scan/?web=1";
      scan.className = "btn secondary";
      scan.textContent = "Keep connecting";
      actions?.appendChild(scan);

    } else if (hasSession && isPendingClaim) {
      // ── Post-claim return: user just authenticated to save ghost activity ─
      logger.log("[Join] Post-claim return detected; running claim and showing success UX");
      const claimResult = await maybeClaimPendingGhostSession();
      if (claimResult?.success) {
        renderClaimSuccessUx(event, claimResult);
        return; // skip intent step, auth handoff, and all generic UX
      }
      // Claim failed — fall through to generic auth UX.
      logger.warn("[Join] Claim attempt failed; falling back to generic auth UX");
      renderGenericJoinUx(event, eventName, source);
      await maybeAutoClaimGhostForAuthenticatedUser(event.id);

    } else if (hasSession) {
      // ── Authenticated user on generic join page (no profileId param) ────
      // Show event info and auth handoff. Never create or show a ghost session —
      // ghost UI is for unauthenticated users only.
      logger.log("[Join] Authenticated user; rendering event join without guest flow");
      renderGenericJoinUx(event, eventName, source);

      if (isMeetupSource) {
        trackFunnelEvent("meetup_handoff_view", {
          eventId:       event.id,
          source:        "meetup",
          sourceEventId: meetupSourceEventId,
          referrer:      document.referrer || null,
        });
      }

      // Claim any ghost session left over from a previous unauthenticated visit.
      // maybeClaimPendingGhostSession handles the sign-in-redirect case (flag set);
      // maybeAutoClaimGhostForAuthenticatedUser handles the direct-auth case (no flag).
      await maybeClaimPendingGhostSession();
      await maybeAutoClaimGhostForAuthenticatedUser(event.id);

      // Anonymous live roster disabled pending consent-scoped backend access.

    } else {
      // ── Unauthenticated → full guest flow ──────────────────────────────
      logger.log("[Join] No authenticated session; rendering guest join flow");
      renderGenericJoinUx(event, eventName, source);

      if (isMeetupSource) {
        trackFunnelEvent("meetup_handoff_view", {
          eventId:       event.id,
          source:        "meetup",
          sourceEventId: meetupSourceEventId,
          referrer:      document.referrer || null,
        });
      }

      trackGuestFunnel("guest_join_viewed", event.id, { source: isMeetupSource ? "meetup" : undefined }, { once: true });
      await initGuestJoinSection(event.id);
      await maybeClaimPendingGhostSession();

      // Anonymous live roster disabled pending consent-scoped backend access.
    }

    showIntentStep();
    await renderAuthHandoff(event.id);
  } catch (error) {
    logger.error("[Join] Initialization failed", error);
    renderInvalidState("We couldn't load this event right now.");
  }
}

document.addEventListener("DOMContentLoaded", initJoinPage);
