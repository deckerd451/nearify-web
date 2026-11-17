/**
 * todayEvent.js — on the signed-out homepage, show events happening today
 * with a one-tap guest join. Shows nothing on days without an event.
 */
import { supabase } from "./supabaseClient.js";

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

function card(ev) {
  const wrap = document.createElement("div");
  wrap.className = "today-event-card";

  const label = document.createElement("p");
  label.className = "today-event-label";
  label.textContent = "Happening today";

  const name = document.createElement("p");
  name.className = "today-event-name";
  name.textContent = ev.name || "Event";

  const meta = document.createElement("p");
  meta.className = "today-event-meta";
  meta.textContent = [formatTime(ev.starts_at), ev.location].filter(Boolean).join(" · ");

  const join = document.createElement("a");
  join.className = "btn primary today-event-join";
  join.href = `/join/?event=${encodeURIComponent(ev.id)}`;
  join.textContent = "Join as a guest";

  wrap.append(label, name);
  if (meta.textContent) wrap.append(meta);
  wrap.append(join);
  return wrap;
}

export async function showTodayEvents() {
  const host = document.getElementById("todayEventSlot");
  if (!host) return;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  try {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, location, starts_at")
      .is("deleted_at", null)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at", { ascending: true })
      .limit(3);
    if (error || !data?.length) return;
    host.replaceChildren(...data.map(card));
    host.hidden = false;
  } catch (_) {
    // Optional enhancement: the homepage works without it.
  }
}

showTodayEvents();
