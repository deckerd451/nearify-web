/**
 * eventBriefView.js — loads the signed-in person's own data and renders
 * "People you might see" in the paper-card style. Used on the event page
 * (after Attend) and on the signed-in home page the day before.
 */
import { buildEventBrief, briefLine } from "./eventBrief.js?v=20261118-brief1";
import { createAccountStore, createLocalStore } from "./localPeople.js?v=20261118-reach1";

/** Everything here is the person's own data. Each source is optional. */
export async function loadBriefData(supabase) {
  const [connections, contexts, handSaved] = await Promise.allSettled([
    supabase.rpc("get_my_connections", { p_status: "all" }).then(({ data, error }) => { if (error) throw error; return data || []; }),
    supabase.rpc("ambient_contexts").then(({ data, error }) => { if (error) throw error; return Array.isArray(data) ? data : []; }),
    createAccountStore(supabase).list().catch(() => createLocalStore().list()),
  ]);
  return {
    connections: connections.status === "fulfilled" ? connections.value : [],
    contexts: contexts.status === "fulfilled" ? contexts.value : [],
    handSaved: handSaved.status === "fulfilled" ? handSaved.value : [],
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Renders into `root` and reveals it.
 * options: { heading, kicker, limit, planHref, planLabel, headingLevel }
 */
export function renderBrief(root, data, { heading = "People you might see", kicker = "", limit, planHref, planLabel = "See your plan", headingLevel = 2 } = {}) {
  const brief = buildEventBrief({ ...data, limit });
  root.replaceChildren();
  root.classList.add("nf-brief");

  const head = el("div", "nf-brief-head");
  if (kicker) head.append(el("p", "nf-brief-kicker", kicker));
  head.append(el("h" + headingLevel, "nf-brief-title", heading));
  root.append(head);

  if (!brief.people.length) {
    const empty = el("p", "nf-brief-empty", "No notes yet about people you’ve met. After this event, save the people you want to remember with one detail, and they’ll show up here next time.");
    const link = el("a", "nf-brief-link", "Save someone you met");
    link.href = "/save/";
    root.append(empty, link);
  } else {
    const list = el("ul", "nf-brief-list");
    for (const person of brief.people) {
      const li = el("li");
      const card = el("a", "nf-paper nf-brief-card");
      card.href = person.href;
      card.append(el("span", "nf-name nf-brief-name", person.name));
      if (person.metAt) card.append(el("span", "nf-brief-met", person.metAt));
      const line = briefLine(person);
      if (line) card.append(el("span", "nf-brief-line", line));
      li.append(card);
      list.append(li);
    }
    root.append(list);
    if (brief.total > brief.people.length) {
      const more = el("a", "nf-brief-link", `All ${brief.total} people you’ve saved`);
      more.href = "/connections/";
      root.append(more);
    }
  }

  const foot = el("div", "nf-brief-foot");
  if (planHref) {
    const plan = el("a", "btn primary nf-brief-plan", planLabel);
    plan.href = planHref;
    foot.append(plan);
  }
  foot.append(el("p", "nf-brief-fine", "From your own notes. Nearify doesn’t know who’s going."));
  root.append(foot);
  root.hidden = false;
  return brief;
}
