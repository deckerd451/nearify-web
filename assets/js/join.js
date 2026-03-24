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

if (topBtn) {
  topBtn.href = deepLink;
}

if (bottomBtn) {
  bottomBtn.href = deepLink;
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
    if (signInBtn) {
      signInBtn.style.display = "none";
    }
  } else {
    console.log("No active session");
    if (descEl) {
      descEl.textContent = "Sign in first, then open Nearify to join the event.";
    }
    if (signInBtn) {
      signInBtn.style.display = "inline-flex";
    }
  }
}

signInBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  try {
    const redirectTo = window.location.href;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo
      }
    });

    if (error) throw error;

    console.log("OAuth redirect started:", data);
  } catch (err) {
    console.error("Sign-in error:", err);
    if (descEl) {
      descEl.textContent = `Sign-in failed: ${err.message || err}`;
    }
  }
});

await refreshAuthState();
