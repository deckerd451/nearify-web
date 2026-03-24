import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log("join.js module loaded");

const supabaseUrl = "https://unndeygygkgodmmdnlup.supabase.co";
const supabaseKey = "sb_publishable_G0KAfCFTovYCWDeEEKWBfg_8UpPHWWZ";

const supabase = createClient(supabaseUrl, supabaseKey);
window.supabase = supabase;

console.log("Supabase attached to window:", window.supabase);

const params = new URLSearchParams(window.location.search);
const eventId = params.get("event");
const eventName = params.get("name") || "this event";

const titleEl = document.getElementById("joinTitle");
const payloadEl = document.getElementById("payloadText");
const topBtn = document.getElementById("openNearifyBtn");
const bottomBtn = document.getElementById("openNearifyBtnBottom");
const signInBtn = document.getElementById("signInBtn");
const descEl = document.getElementById("joinDescription");

const deepLink = eventId ? `beacon://event/${eventId}` : "#";

if (titleEl) {
  titleEl.textContent = `Open Nearify to join ${eventName}`;
}

if (payloadEl) {
  payloadEl.textContent = deepLink;
}

async function ensureProfileFromSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const user = sessionData.session?.user;
  if (!user) throw new Error("No authenticated user");

  const name =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "Nearify User";

  const email = user.email || null;
  const avatarUrl = user.user_metadata?.avatar_url || null;

  const { data, error } = await supabase.rpc("ensure_profile", {
    p_name: name,
    p_email: email,
    p_avatar_url: avatarUrl
  });

  if (error) throw error;
  return data;
}

async function joinEventById(id) {
  const { data, error } = await supabase.rpc("join_event", {
    p_event_id: id
  });

  if (error) throw error;
  return data;
}

async function openNearifyFlow(e) {
  e.preventDefault();

  try {
    if (!eventId) throw new Error("Missing event ID");

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;

    if (!session?.user) {
      if (descEl) descEl.textContent = "Please sign in first.";
      return;
    }

    if (descEl) descEl.textContent = "Preparing your event entry...";

    const profile = await ensureProfileFromSession();
    console.log("Profile ensured:", profile);

    const attendee = await joinEventById(eventId);
    console.log("Event joined:", attendee);

    if (descEl) descEl.textContent = "Opening Nearify...";

    window.location.href = deepLink;
  } catch (err) {
    console.error("Open Nearify flow failed:", err);
    if (descEl) {
      descEl.textContent = err.message || "Could not join event.";
    }
  }
}

async function refreshAuthState() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("getSession error:", error);
    if (descEl) descEl.textContent = "Error checking sign-in state.";
    return;
  }

  const session = data.session;

  if (session?.user) {
    console.log("Signed in as:", session.user.email);
    if (descEl) {
      descEl.textContent = `Signed in as ${session.user.email}. Open Nearify to continue into the event.`;
    }
    if (signInBtn) signInBtn.style.display = "none";
  } else {
    console.log("No active session");
    if (descEl) {
      descEl.textContent = "Sign in first, then open Nearify to join the event.";
    }
    if (signInBtn) signInBtn.style.display = "inline-flex";
  }
}

signInBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  try {
    const redirectTo = window.location.href;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });

    if (error) throw error;
  } catch (err) {
    console.error("Sign-in error:", err);
    if (descEl) {
      descEl.textContent = `Sign-in failed: ${err.message || err}`;
    }
  }
});

topBtn?.addEventListener("click", openNearifyFlow);
bottomBtn?.addEventListener("click", openNearifyFlow);

await refreshAuthState();
