import { supabase, createScopedSupabaseClient } from "./supabaseClient.js";
import { loadGhostSession, createGhostSession } from "./ghostSession.js";
import { connectGhostToProfile } from "./ghostConnection.js";
import { trackAppCtaClick } from "./analytics.js";
import { escapeHtml, copyText } from "./utils.js";

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

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    eventId: params.get("event"),
    eventName: params.get("name"),
    profileId: params.get("profile"),
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

function setJoinMode(mode) {
  document.body.classList.remove("join-mode-generic", "join-mode-personal-connect");
  document.body.classList.add(mode === "personal-connect" ? "join-mode-personal-connect" : "join-mode-generic");
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

async function fetchPublicProfileBrief(profileId) {
  if (!profileId) return null;

  const { data, error } = await supabase
    .rpc("get_public_profile_brief", { p_profile_id: profileId })
    .maybeSingle();

  if (error) {
    console.warn("[Join] Public target profile lookup failed", { profileId, error });
    return null;
  }

  if (data?.id && data?.name) {
    console.log("[Join] Resolved public target profile", { id: data.id, name: data.name });
    return data;
  }

  console.log("[Join] Public target profile not found, using fallback copy", { profileId });
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

async function maybeConnectGhostToProfile(eventId, profileId) {
  if (!eventId || !profileId) return null;

  try {
    const result = await connectGhostToProfile(eventId, profileId);
    console.log("[Ghost] Auto-connected to profile", result);
    return result;
  } catch (error) {
    console.error("[Ghost] Auto-connect failed", error);
    return null;
  }
}

function renderGhostState(ghost) {
  if (!ghost) return;
  console.log("[Ghost] Active session", ghost);
}

function setGhostClaimStatus(message) {
  if (!els.ghostClaimStatus) return;
  setText(els.ghostClaimStatus, message);
}

async function fetchCurrentProfileId() {
  const { data, error } = await supabase.rpc("current_profile_id");
  if (error) {
    console.warn("[Ghost] Could not resolve current profile id", error);
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
    console.error("[Ghost] OAuth start failed", error);
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
    console.warn("[Ghost] Failed to load ghost history", error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function maybeClaimGhostActivity(ghost, isClaimed) {
  if (!ghost?.ghostId || !ghost?.ghostToken) return;
  if (isClaimed) return;

  const { data: sessionData } = await supabase.auth.getSession();
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
    console.warn("[Ghost] Claim RPC failed", error);
    setGhostClaimStatus("We couldn't claim this yet. Please try again.");
    return false;
  }

  console.log("[Ghost] Claim successful", data);
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
      if (!email || !email.includes("@")) {
        if (emailInput) emailInput.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.classList.add("loading");
      try {
        await saveGhostEmail(ghost, email);
      } catch (err) {
        console.warn("[Ghost] Email save failed", err);
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

    const { data: sessionData } = await supabase.auth.getSession();
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
    chip.addEventListener("click", () => {
      chips.forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-pressed", "false");
      });
      chip.classList.add("active");
      chip.setAttribute("aria-pressed", "true");
      if (gate) show(gate);
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

function renderGenericJoinUx(event, fallbackName) {
  setJoinMode("generic");

  const title = event?.name || fallbackName || "Join Event";

  hide(els.joinSuccessBadge);
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
  renderPayload(event.id);

  if (els.getAppBtn) els.getAppBtn.textContent = "Get Nearify (TestFlight)";
  if (els.alreadyInstalledHint) {
    els.alreadyInstalledHint.textContent =
      "Already installed? Open the app to browse, join, and check in (or scan the event QR code).";
  }

  if (els.joinPanelTitle) els.joinPanelTitle.textContent = "3 steps to join";
  if (els.joinPanelList) {
    els.joinPanelList.className = "join-steps-list";
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

  if (els.joinBottomCtaTitle) els.joinBottomCtaTitle.textContent = "Ready to join?";
  if (els.joinBottomCtaDescription) {
    els.joinBottomCtaDescription.textContent =
      "Install the app, then join and check in when you arrive (in app or via event QR).";
  }
  if (els.joinBottomCtaButton) els.joinBottomCtaButton.textContent = "Get Nearify on TestFlight";
  if (els.joinBottomCtaHint) els.joinBottomCtaHint.textContent = "Already installed? Open the app to browse, join, and check in.";

  show(els.joinQrBox);
  console.log("[Join] Rendering generic event join UX");
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

  console.log(`[Join] Rendering personal connect UX for ${personName}`);
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
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session?.access_token) return;

  const deepLink = new URL("beacon://auth");
  deepLink.searchParams.set("token", session.access_token);
  deepLink.searchParams.set("refresh", session.refresh_token);
  if (eventId) deepLink.searchParams.set("event", eventId);
  const deepLinkStr = deepLink.toString();

  const section = document.getElementById("authHandoffSection");
  if (!section) return;

  const openBtn = document.getElementById("authHandoffOpenBtn");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      trackAppCtaClick("join_auth_handoff_open", eventId ? { eventId } : {});
      window.location.href = deepLinkStr;
      setTimeout(() => {
        const fallback = document.getElementById("authHandoffFallback");
        if (fallback && document.visibilityState === "visible") show(fallback);
      }, 1200);
    });
  }

  // QR code for desktop users transferring session to their phone
  const qrBox = document.getElementById("authHandoffQrBox");
  const qrContainer = document.getElementById("authHandoffQr");
  if (qrContainer && qrBox && typeof window.QRCode === "function") {
    new window.QRCode(qrContainer, { text: deepLinkStr, width: 180, height: 180 });
    show(qrBox);
  }

  show(section);
}

async function initJoinPage() {
  const { eventId, eventName, profileId } = getQueryParams();

  console.log("[Join] URL at startup", window.location.href);

  if (!eventId) {
    renderInvalidState("This link is missing an event id.");
    return;
  }

  try {
    const [event, targetProfile] = await Promise.all([
      fetchEvent(eventId),
      profileId ? fetchPublicProfileBrief(profileId) : Promise.resolve(null),
    ]);

    if (!event || event.deleted_at || event.is_active === false) {
      renderInvalidState("This event is no longer active.");
      return;
    }

    let connectResult = null;
    const ghost = await ensureGhostForEvent(event.id);
    renderGhostState(ghost);
    if (profileId) {
      connectResult = await maybeConnectGhostToProfile(event.id, profileId);
    }

    let historyRows = await fetchGhostConnectionHistory(ghost, event.id);
    const { data: sessionData } = await supabase.auth.getSession();
    const hasSession = !!sessionData?.session?.user;
    let isClaimed = historyRows.some((row) => row?.claimed_profile_id);

    if (hasSession && !isClaimed) {
      const claimed = await maybeClaimGhostActivity(ghost, isClaimed);
      if (claimed) {
        historyRows = await fetchGhostConnectionHistory(ghost, event.id);
        isClaimed = historyRows.some((row) => row?.claimed_profile_id);
      }
    }

    wireClaimButtons(ghost, isClaimed);

    if (profileId) {
      renderPersonalConnectUx(event, targetProfile);
      const uniqueNames = [...new Set(historyRows.map((row) => row?.to_profile_name).filter(Boolean))];
      const hasHistory = uniqueNames.length > 1;
      const state = getJoinState({ session: hasSession, hasHistory, isClaimed });
      renderGhostJourneyCard({
        state,
        personName: targetProfile?.name || "this person",
        historyRows,
      });

      if (connectResult) {
        console.log("[Join] Personal connect UX rendered after successful connection");
      }
    } else {
      renderGenericJoinUx(event, eventName);
    }

    showIntentStep();
    await renderAuthHandoff(event.id);
  } catch (error) {
    console.error("[Join] Initialization failed", error);
    renderInvalidState("We couldn't load this event right now.");
  }
}

document.addEventListener("DOMContentLoaded", initJoinPage);
