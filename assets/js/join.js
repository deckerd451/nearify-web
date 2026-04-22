import { supabase } from "./supabaseClient.js";
import { loadGhostSession, createGhostSession } from "./ghostSession.js";
import { connectGhostToProfile } from "./ghostConnection.js";

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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

  const bits = [event.location, formatDateTime(event.starts_at)].filter(Boolean);

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

function showIntentStep() {
  if (!els.intentStep) return;
  show(els.intentStep);
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
      "Already installed? Open the app and scan the event QR code.";
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
        <div class="join-step-label">Scan the event QR code</div>
        <div class="join-step-detail">Find the Nearify QR at the venue and scan it to enter the live network.</div>
      </li>
    `;
  }

  if (els.joinBottomCtaTitle) els.joinBottomCtaTitle.textContent = "Ready to join?";
  if (els.joinBottomCtaDescription) {
    els.joinBottomCtaDescription.textContent =
      "Install the app, then scan the event QR code when you arrive.";
  }
  if (els.joinBottomCtaButton) els.joinBottomCtaButton.textContent = "Get Nearify on TestFlight";
  if (els.joinBottomCtaHint) els.joinBottomCtaHint.textContent = "Already installed? Open the app and scan again.";

  show(els.joinQrBox);
  console.log("[Join] Rendering generic event join UX");
}

function renderPersonalConnectUx(event, targetProfile) {
  setJoinMode("personal-connect");

  const personName = targetProfile?.name || "this person";
  const eventName = event?.name || "this event";

  show(els.joinSuccessBadge);
  setText(els.joinKicker, "Connection saved");
  setText(els.joinTitle, `You just connected with ${personName}`);
  setText(
    els.joinDescription,
    `Your connection to ${personName} has been saved for ${eventName}. Tell Nearify what you're here to do so the experience becomes more relevant from here.`
  );

  renderEventMeta(event);

  // Keep beacon payload available below for app users, but deemphasize it.
  renderPayload(event.id);

  if (els.getAppBtn) els.getAppBtn.textContent = "Get Nearify to go further";
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
        <div class="join-step-detail">You don't need to repeat this step — ${personName} is now in your event network.</div>
      </li>
      <li>
        <div class="join-step-label">Tell Nearify what you're here for</div>
        <div class="join-step-detail">Set your intent so Nearify can prioritize people and conversations that match your goals.</div>
      </li>
      <li>
        <div class="join-step-label">Get the app to explore who's here</div>
        <div class="join-step-detail">Open Nearify to discover more attendees nearby and keep building momentum at ${eventName}.</div>
      </li>
    `;
  }

  if (els.joinBottomCtaTitle) els.joinBottomCtaTitle.textContent = "Take this connection further";
  if (els.joinBottomCtaDescription) {
    els.joinBottomCtaDescription.textContent =
      "You've already connected. Get Nearify to explore the event, discover more people nearby, and keep the momentum going.";
  }
  if (els.joinBottomCtaButton) els.joinBottomCtaButton.textContent = "Get Nearify to go further";
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

    const ghost = await ensureGhostForEvent(event.id);
    renderGhostState(ghost);

    let connectResult = null;
    if (profileId) {
      connectResult = await maybeConnectGhostToProfile(event.id, profileId);
    }

    if (profileId) {
      renderPersonalConnectUx(event, targetProfile);

      if (connectResult) {
        console.log("[Join] Personal connect UX rendered after successful connection");
      }
    } else {
      renderGenericJoinUx(event, eventName);
    }

    showIntentStep();
  } catch (error) {
    console.error("[Join] Initialization failed", error);
    renderInvalidState("We couldn't load this event right now.");
  }
}

document.addEventListener("DOMContentLoaded", initJoinPage);
