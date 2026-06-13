import { supabase, createScopedSupabaseClient, getSessionCached } from "./supabaseClient.js";
import { cachedRead, dedupeRequest, logHiddenPollPause, withRetry } from "./supabaseLoad.js";
import { loadGhostSession, saveGhostSession, createGhostSession } from "./ghostSession.js";
import { computeIntentAlignment } from "./intelligence-algo.js";
import { connectGhostToProfile } from "./ghostConnection.js";
import { trackAppCtaClick, trackFunnelEvent } from "./analytics.js";
import { escapeHtml, copyText } from "./utils.js";
import { logger } from "./logger.js";
import { pollingCoordinator } from "./pollingCoordinator.js";

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

  const bits = [event.name, formatDateTime(event.starts_at), event.location].filter(Boolean);

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
  setGhostClaimStatus("Sign in to save your connections.");
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
  setGhostClaimStatus("This connection is now part of your network.");
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
    setText(els.ghostReturnLead, "This connection is saved temporarily. Create your profile to keep it and continue building your network.");
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
    setText(els.ghostReturnLead, "These connections are saved temporarily.");
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
    setText(els.ghostReturnLead, "This connection is now part of your Nearify profile.");
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
    setText(els.joinTitle, "You're joining the live network for this event.");
    setText(
      els.joinDescription,
      "See who's going, find people worth talking to, and stay connected after the event ends — without chasing down contact info later."
    );
  } else {
    setText(els.joinTitle, title);
    if (event?.description) {
      setText(els.joinDescription, event.description);
    } else {
      setText(
        els.joinDescription,
        "Nearify shows you who's actually at this event so you can discover and connect in real time."
      );
    }
  }

  renderEventMeta(event);
  renderPayload(event.id);

  if (els.getAppBtn) els.getAppBtn.textContent = isMeetup ? "Enter Live Network" : "Get Nearify (TestFlight)";
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
    els.joinPanelTitle.textContent = isMeetup ? "What happens when you join" : "3 steps to join";
  }
  if (els.joinPanelList) {
    els.joinPanelList.className = "join-steps-list";
    if (isMeetup) {
      els.joinPanelList.innerHTML = `
        <li>
          <div class="join-step-label">See who's actually here</div>
          <div class="join-step-detail">Real attendee presence, not an RSVP count. Get the app to see who's in the live network.</div>
        </li>
        <li>
          <div class="join-step-label">Let relevant people find you</div>
          <div class="join-step-detail">Your profile signals your intent. Others with aligned goals can discover you before you even meet.</div>
        </li>
        <li>
          <div class="join-step-label">Keep who you meet after it ends</div>
          <div class="join-step-detail">Check in at the venue. The connections you make become part of your persistent network.</div>
        </li>
      `;
    } else {
      els.joinPanelList.innerHTML = `
        <li>
          <div class="join-step-label">Install Nearify</div>
          <div class="join-step-detail">Get the app on TestFlight — takes about 2 minutes.</div>
        </li>
        <li>
          <div class="join-step-label">Sign in &amp; create your profile</div>
          <div class="join-step-detail">Use Google or GitHub. Your profile is how people find you.</div>
        </li>
        <li>
          <div class="join-step-label">Check in when you arrive</div>
          <div class="join-step-detail">Check in from the Nearify iOS app, or scan the venue QR to enter the live network.</div>
        </li>
      `;
    }
  }

  if (els.joinBottomCtaTitle) els.joinBottomCtaTitle.textContent = isMeetup ? "Ready to enter the live network?" : "Ready to join?";
  if (els.joinBottomCtaDescription) {
    els.joinBottomCtaDescription.textContent = isMeetup
      ? "See who else is going, discover people worth talking to, and keep the connections that matter."
      : "Install the app, then join and check in when you arrive (in app or via event QR).";
  }
  if (els.joinBottomCtaButton) els.joinBottomCtaButton.textContent = isMeetup ? "Enter Live Network" : "Get Nearify on TestFlight";
  if (els.joinBottomCtaHint) els.joinBottomCtaHint.textContent = "Already installed? Open the app to browse, join, and check in.";

  // ── CTA click tracking ──────────────────────────────────────────────────
  // Wire once per render; { once: true } prevents duplicate events on re-render.
  if (els.getAppBtn) {
    els.getAppBtn.addEventListener("click", (e) => {
      if (isMeetup) {
        // For Meetup source: attempt to open the specific event in the iOS app
        // instead of navigating directly to TestFlight.
        e.preventDefault();
        trackFunnelEvent("enter_live_network_clicked", {
          eventId: event.id, source: "meetup",
          sourceEventId: meetupSourceEventId, button: "hero_primary",
        });
        attemptEventDeepLink(event.id, "hero_primary");
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
        e.preventDefault();
        trackFunnelEvent("enter_live_network_clicked", {
          eventId: event.id, source: "meetup",
          sourceEventId: meetupSourceEventId, button: "bottom_cta",
        });
        attemptEventDeepLink(event.id, "bottom_cta");
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
  setText(els.joinDescription, "This connection has been saved for this event.");

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
    countEl.textContent = count === 1
      ? "We recovered 1 connection."
      : count > 1
        ? `We recovered ${count} connections.`
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

  show(section);
  logger.log("[GuestClaim] Claim success UX rendered", { count, names });
  trackFunnelEvent("ghost_claim_success_shown", {
    eventId: event?.id || null,
    count,
    source:  isMeetupSource ? "meetup" : null,
  });
}

function showGuestJoinCta() {
  const cta = document.getElementById("guestJoinCta");
  show(cta);
}

function showGuestForm() {
  const section = document.getElementById("guestJoinSection");
  const form = document.getElementById("guestForm");
  const joined = document.getElementById("guestJoinedState");
  show(section);
  show(form);
  hide(joined);
  const input = document.getElementById("guestDisplayName");
  if (input) input.focus();
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

async function fetchGuestEventAttendees(eventId) {
  console.log("[GuestAttendees] Loading attendees for event", eventId);
  if (!eventId) return { attendees: [] };
  if (attendeeRequestByEventId.has(eventId)) {
    return attendeeRequestByEventId.get(eventId);
  }
  const request = dedupeRequest(`attendees:${eventId}`, () =>
    withRetry("join:get_public_event_attendees", () => supabase.rpc("get_public_event_attendees", {
      p_event_id: eventId,
    }))
  )
    .then(({ data, error }) => {
      console.log("[GuestAttendees] get_public_event_attendees result", data, error);

      if (error) {
        logger.warn("[GuestAttendees] RPC failed", error.message, error.code);
        return { attendees: [], loadError: "Couldn't load attendees." };
      }

      if (!data?.length) {
        return { attendees: [], empty: "No attendees found for this event yet." };
      }

      const normalized = data
        .filter((r) => r.name)
        .map((r) => {
          const attendee = {
            profileId:          r.profile_id,
            name:               r.name,
            avatarUrl:          r.avatar_url || null,
            intent:             r.intent_primary || null,
            relationshipStatus: r.relationship_status ?? null,
          };
          logger.log("[RelationshipVisibility]", `relationshipStatus=${attendee.relationshipStatus}`, attendee.name);
          return attendee;
        });

      console.log("[GuestAttendees] normalized attendees", normalized);
      return { attendees: normalized };
    })
    .finally(() => attendeeRequestByEventId.delete(eventId));
  attendeeRequestByEventId.set(eventId, request);
  return request;
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
  if (count > 0) {
    btn.textContent = count === 1 ? "Claim your 1 interaction" : `Claim your ${count} interactions`;
  } else {
    btn.textContent = "Sign in to save your interactions";
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
          ? `<span class="guest-attendee-rel-badge">Wants to connect</span>`
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
  const eventId    = localStorage.getItem("nearify_ghost_event_id");

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

function showGuestJoinedState(ghost) {
  const section = document.getElementById("guestJoinSection");
  const form = document.getElementById("guestForm");
  const joined = document.getElementById("guestJoinedState");
  const nameEl = document.getElementById("guestJoinedName");
  const cta = document.getElementById("guestJoinCta");

  saveGhostFlatKeys(ghost);

  hide(form);
  hide(cta);
  show(section);
  show(joined);
  if (nameEl) nameEl.textContent = ghost.displayName || "";

  const joinedLabel = joined?.querySelector(".guest-joined-label");
  if (joinedLabel && isMeetupSource) {
    joinedLabel.textContent = "You're in the live Nearify network for this event.";
  }

  wireGuestConnectSection();
  loadGuestConnectionHistory().then((connections) => {
    renderGuestConnectionHistory(connections);
    updateClaimButtonCount(connections.length);
  });

  const connectEventId = ghost.eventId
    || localStorage.getItem("nearify_ghost_event_id")
    || new URLSearchParams(window.location.search).get("event");

  if (connectEventId) {
    fetchGuestEventAttendees(connectEventId).then(({ attendees, loadError, empty }) => {
      guestEventAttendees = attendees;
      logger.log("[GuestConnect] Loaded", attendees.length, "attendees");

      if (ghostIntentPrimary && attendees.length > 0) {
        const recs = computeGhostRecommendations(attendees, ghostIntentPrimary);
        renderGhostRecommendations(recs, connectEventId);
      }

      const statusEl = document.getElementById("guestConnectStatus");
      if (statusEl) {
        if (loadError) {
          statusEl.textContent = loadError;
        } else if (empty) {
          statusEl.textContent = empty;
        } else if (attendees.length > 0) {
          // Attendees loaded — placeholder is no longer needed; clear only if
          // no connection message is already showing.
          if (statusEl.textContent === "Search for someone you met and save the interaction.") {
            statusEl.textContent = "";
          }
        }
      }
    });
  }

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

      logger.log("[GuestClaim] Starting sign-in to claim guest session");
      localStorage.setItem("nearify_pending_ghost_claim", "true");

      claimBtn.disabled = true;
      claimBtn.textContent = "Signing in…";

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });

      if (error) {
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
    logger.warn("[GuestClaim] Could not resolve profile id", profileError);
    if (statusEl) statusEl.textContent = "We couldn't find your Nearify profile after sign-in. Your guest session is still saved.";
    return null;
  }

  const profileId = profileData.id;
  console.log("[GuestClaim] Resolved profile id", profileId);

  // Fetch connection history BEFORE clearing keys — used for the success screen.
  const history      = await fetchGhostConnectionHistory({ ghostId, ghostToken }, ghostEventId);
  const claimedNames = [...new Set(history.map((r) => r?.to_profile_name).filter(Boolean))];

  // The scoped client starts with no auth session (persistSession: false).
  // Inject the current user's JWT so auth.uid() resolves correctly inside
  // claim_ghost_activity — without this, current_profile_id() returns null
  // and the function raises P0001 Forbidden.
  const scoped = createScopedSupabaseClient({ "x-ghost-token": ghostToken });
  await scoped.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  const { data: claimData, error } = await scoped.rpc("claim_ghost_activity", {
    p_ghost_id: ghostId,
    p_profile_id: profileId,
  });

  if (error) {
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
    count:         claimData?.interactions_claimed ?? claimedNames.length,
    names:         claimedNames,
    intentPrimary,
  };
}

async function handleGuestSubmit(eventId) {
  const input = document.getElementById("guestDisplayName");
  const errorEl = document.getElementById("guestNameError");
  const statusEl = document.getElementById("guestJoinStatus");
  const submitBtn = document.getElementById("guestSubmitBtn");

  const name = input?.value?.trim();

  if (errorEl) errorEl.style.display = "none";
  if (statusEl) statusEl.textContent = "";

  if (!name) {
    if (errorEl) errorEl.style.display = "";
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
    trackFunnelEvent("guest_session_created", {
      eventId,
      source:        isMeetupSource ? "meetup" : null,
      sourceEventId: isMeetupSource ? meetupSourceEventId : null,
    });
    showGhostIntentStep(ghost, eventId);
    logger.log("[Guest] Joined as guest", ghost);
  } catch (err) {
    logger.error("[Guest] Failed to create ghost session", err);
    if (statusEl) statusEl.textContent = "Something went wrong. Please try again.";
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Join as Guest";
    }
  }
}

// ── Ghost intent step ────────────────────────────────────────────────────────

function showGhostIntentStep(ghost, eventId) {
  const form = document.getElementById("guestForm");
  const intentStep = document.getElementById("ghostIntentStep");
  hide(form);
  show(intentStep);

  intentStep.querySelectorAll(".ghost-intent-chip").forEach((chip) => {
    chip.addEventListener("click", () => handleGhostIntentSelect(chip.dataset.intent, ghost, eventId), { once: true });
  });
}

function handleGhostIntentSelect(intent, ghost, eventId) {
  ghostIntentPrimary = intent;

  const existing = loadGhostSession(eventId);
  if (existing) {
    saveGhostSession(eventId, { ...existing, intentPrimary: intent });
  }

  trackFunnelEvent("ghost_intent_selected", {
    eventId,
    intent,
    source: isMeetupSource ? "meetup" : null,
  });

  hide(document.getElementById("ghostIntentStep"));
  showGuestJoinedState(ghost);
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
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleGuestSubmit(eventId);
      }
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      const form = document.getElementById("guestForm");
      const cta = document.getElementById("guestJoinCta");
      const section = document.getElementById("guestJoinSection");
      hide(form);
      hide(section);
      show(cta);
    });
  }
  // guestClaimSignInBtn is wired inside showGuestJoinedState, not here,
  // so it fires for both new-join and restored-session paths.
}

function initGuestJoinSection(eventId) {
  const existing = loadGhostSession(eventId);
  if (existing?.ghostId) {
    ghostIntentPrimary = existing.intentPrimary || null;
    showGuestJoinedState(existing);  // saves flat keys + wires claim btn
    logger.log("[Guest] Restored existing ghost session on page load");
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
  if (!session?.user?.id) { clearGhostSession(); return; }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const profileId = profileData?.id;
  if (!profileId) {
    logger.warn("[Ghost] Auto-claim: no profile found for authenticated user");
    clearGhostSession();
    return;
  }

  const scoped = createScopedSupabaseClient({ "x-ghost-token": ghostToken });
  await scoped.auth.setSession({
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
  });

  const { error } = await scoped.rpc("claim_ghost_activity", {
    p_ghost_id:   ghostId,
    p_profile_id: profileId,
  });

  if (error) {
    logger.warn("[Ghost] Auto-claim failed", error.message);
  } else {
    logger.log("[Ghost] Auto-claim succeeded");
  }

  clearGhostSession();
}

async function initJoinPage() {
  const { eventId, eventName, profileId, source, sourceEventId } = getQueryParams();

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

    if (profileId && hasSession) {
      // ── Personal connect flow: authenticated visitor scanned someone's QR ─
      logger.log("[Join] Authenticated profile detected; rendering personal connect");

      let connectResult = null;
      const ghost = await ensureGhostForEvent(event.id);
      renderGhostState(ghost);
      connectResult = await maybeConnectGhostToProfile(event.id, profileId);

      let historyRows = await fetchGhostConnectionHistory(ghost, event.id);
      let isClaimed = historyRows.some((row) => row?.claimed_profile_id);

      if (!isClaimed) {
        const claimed = await maybeClaimGhostActivity(ghost, isClaimed);
        if (claimed) {
          historyRows = await fetchGhostConnectionHistory(ghost, event.id);
          isClaimed = historyRows.some((row) => row?.claimed_profile_id);
        }
      }

      wireClaimButtons(ghost, isClaimed);

      renderPersonalConnectUx(event, targetProfile);
      const uniqueNames = [...new Set((historyRows || []).map((row) => row?.to_profile_name).filter(Boolean))];
      const hasHistory = uniqueNames.length > 1;
      const state = getJoinState({ session: hasSession, hasHistory, isClaimed });
      renderGhostJourneyCard({
        state,
        personName: targetProfile?.name || "this person",
        historyRows,
      });

      if (connectResult) {
        logger.log("[Join] Personal connect UX rendered after successful connection");
      }

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

      if (isMeetupSource) {
        renderLiveStatusIndicator();
        fetchGuestEventAttendees(event.id).then(({ attendees }) => {
          guestEventAttendees  = attendees;
          lastKnownAttendees   = attendees.slice();
          renderLiveAttendeePreview(attendees);
          startLivePolling(event.id);
        });
      }

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

      initGuestJoinSection(event.id);
      await maybeClaimPendingGhostSession();

      if (isMeetupSource) {
        renderLiveStatusIndicator();
        // Initial fetch: render preview, seed the diff baseline, start polling.
        fetchGuestEventAttendees(event.id).then(({ attendees }) => {
          guestEventAttendees  = attendees;
          lastKnownAttendees   = attendees.slice();
          renderLiveAttendeePreview(attendees);
          startLivePolling(event.id);
        });
      }
    }

    showIntentStep();
    await renderAuthHandoff(event.id);
  } catch (error) {
    logger.error("[Join] Initialization failed", error);
    renderInvalidState("We couldn't load this event right now.");
  }
}

document.addEventListener("DOMContentLoaded", initJoinPage);
