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
