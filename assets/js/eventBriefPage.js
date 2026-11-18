/**
 * eventBriefPage.js — on an event page, once you've tapped Attend (or had
 * already), show "People you might see" at the top of your plan.
 *
 * eventDetail.js announces the loaded event ("nearify:event-ready") and a
 * fresh Attend ("nearify:attending"). This module never reads other people's
 * attendance; it checks only the viewer's own row.
 */
import { supabase, getSessionCached } from "./supabaseClient.js";
import { loadBriefData, renderBrief } from "./eventBriefView.js?v=20261118-brief1";

const slot = document.getElementById("eventBriefSlot");
let shownFor = null;

function upcoming(event) {
  const start = Date.parse(event?.starts_at);
  if (Number.isNaN(start)) return false;
  const end = Date.parse(event?.ends_at) || start + 3 * 3600000;
  return end > Date.now();
}

async function attending(eventId) {
  const { data: session } = await getSessionCached();
  const userId = session?.session?.user?.id;
  if (!userId) return false;
  const { data: me } = await supabase.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  if (!me?.id) return false;
  const { data: row } = await supabase.from("event_attendees").select("status")
    .eq("event_id", eventId).eq("profile_id", me.id).maybeSingle();
  return Boolean(row) && row.status !== "left";
}

async function show(event, { confirmed = false } = {}) {
  if (!slot || !event?.id || shownFor === event.id || !upcoming(event)) return;
  try {
    if (!confirmed && !(await attending(event.id))) return;
    shownFor = event.id;
    const data = await loadBriefData(supabase);
    renderBrief(slot, data, { heading: "People you might see", kicker: "Before you go", headingLevel: 3 });
  } catch (_) {
    shownFor = null; // optional panel: the event page works without it
  }
}

document.addEventListener("nearify:event-ready", (e) => show(e.detail?.event));
document.addEventListener("nearify:attending", (e) => show(e.detail?.event, { confirmed: true }));
if (window.__NEARIFY_EVENT__) show(window.__NEARIFY_EVENT__);
