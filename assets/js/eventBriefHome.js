/**
 * eventBriefHome.js — on the signed-in home page, from 36 hours before an
 * event you're attending until it ends: "Tomorrow: Show & Tell. People you
 * might see", from your own notes.
 */
import { supabase, getSessionCached } from "./supabaseClient.js";
import { isBriefWindow, whenLabel } from "./eventBrief.js?v=20261118-brief1";
import { loadBriefData, renderBrief } from "./eventBriefView.js?v=20261118-brief1";

const root = document.getElementById("eventBriefHome");

async function nextAttendedEvent() {
  const { data: session } = await getSessionCached();
  const userId = session?.session?.user?.id;
  if (!userId) return null;
  const { data: me } = await supabase.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  if (!me?.id) return null;
  const { data: rows } = await supabase.from("event_attendees").select("event_id, status").eq("profile_id", me.id);
  const ids = [...new Set((rows || []).filter((r) => r.status !== "left").map((r) => r.event_id).filter(Boolean))];
  if (!ids.length) return null;
  const { data: events } = await supabase.from("events")
    .select("id, name, slug, starts_at, ends_at").in("id", ids).is("deleted_at", null);
  return (events || []).filter((e) => isBriefWindow(e))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] || null;
}

async function init() {
  if (!root) return;
  try {
    const event = await nextAttendedEvent();
    if (!event) return;
    const data = await loadBriefData(supabase);
    const when = whenLabel(event.starts_at);
    renderBrief(root, data, {
      kicker: when ? `${when}: ${event.name}` : event.name,
      heading: "People you might see",
      limit: 3,
      planHref: `/events/event.html?id=${encodeURIComponent(event.id)}#prepare`,
      planLabel: "Open your plan",
    });
  } catch (_) {
    // Optional card: the home page works without it.
  }
}

init();
