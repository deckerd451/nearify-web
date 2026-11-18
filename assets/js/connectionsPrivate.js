/**
 * connectionsPrivate.js — on /connections/, list the people the signed-in
 * person saved by hand on /save/. Owner-only rows; shows nothing on error
 * (for example before the private_contacts table exists).
 */
import { supabase, getSessionCached } from "./supabaseClient.js";
import { createAccountStore } from "./localPeople.js?v=20261118-reach1";
import { reachActions } from "./reach.js?v=20261118-reach1";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function showPrivateContacts() {
  const section = document.getElementById("privateContactsSection");
  const list = document.getElementById("privateContactsList");
  if (!section || !list) return;
  try {
    const { data } = await getSessionCached();
    if (!data?.session?.user) return;
    const people = await createAccountStore(supabase).list();
    if (!people.length) return;
    list.replaceChildren(...people.map((person) => {
      const li = el("li", "private-contact");
      li.setAttribute("role", "listitem");
      li.append(el("h3", "private-contact-name", person.name));
      const d = new Date(person.savedAt);
      const met = [person.where, Number.isNaN(d.getTime()) ? "" : "saved " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" })]
        .filter(Boolean).join(", ");
      if (met) li.append(el("p", "private-contact-met", met));
      if (person.note) li.append(el("p", "private-contact-note", person.note));
      const [action] = reachActions(person);
      if (action) {
        const link = el("a", "private-contact-reach", action.label);
        link.href = action.href;
        if (action.external) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
        li.append(link);
      } else if (person.reach) {
        li.append(el("p", "private-contact-met", person.reach));
      }
      return li;
    }));
    section.hidden = false;
  } catch (_) {
    // Optional section: the rest of the page works without it.
  }
}

showPrivateContacts();
