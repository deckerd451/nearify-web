/**
 * savePerson.js — /save/: save someone you met, no QR and no account needed.
 *
 * Signed out: people are kept in this browser only.
 * Signed in: people are kept in the owner-only private_contacts table, and
 * anything saved on this device before signing in is moved there once.
 * If the table isn't available yet, the page keeps working on this device.
 *
 * Saving on this device must work the moment the page opens, so the Supabase
 * client (loaded from a CDN) is imported lazily, only for account features.
 */
import { logger } from "./logger.js";
import { buildGuestRecap } from "./guestRecap.js?v=20261118-recap1";
import {
  buildFollowUpIcs, createAccountStore, createLocalStore, followUpFileName, makePerson,
} from "./localPeople.js?v=20261118-save1";

const $ = (id) => document.getElementById(id);
const form = $("spForm");
const nameInput = $("spName");
const whereInput = $("spWhere");
const noteInput = $("spNote");
const saveBtn = $("spSave");
const savedMark = $("spSavedMark");
const status = $("spStatus");
const errorEl = $("spError");
const listEl = $("spList");

const device = createLocalStore();
let clientPromise = null;
const loadClient = () => (clientPromise ||= import("./supabaseClient.js").catch((err) => { clientPromise = null; throw err; }));
let store = device;
let people = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function savedOn(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function updateSaveLabel() {
  const first = nameInput.value.trim().split(/\s+/)[0];
  saveBtn.textContent = first ? `Save ${first.slice(0, 20)}` : "Save";
}

function downloadReminder(person) {
  const blob = new Blob([buildFollowUpIcs(person)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = followUpFileName(person);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function personCard(person) {
  const li = el("li", "nf-paper sp-person");
  li.id = "person-" + person.id;
  const head = el("div", "sp-person-head");
  head.append(el("span", "sp-avatar", initials(person.name)));
  const who = el("div");
  who.append(el("h3", "nf-name sp-person-name", person.name));
  const met = [person.where, savedOn(person.savedAt)].filter(Boolean).join(", ");
  if (met) who.append(el("p", "sp-person-met", met));
  head.append(who);
  li.append(head);
  if (person.note) li.append(el("p", "sp-person-note", person.note));

  const actions = el("div", "sp-person-actions");
  const remind = el("button", "sp-person-btn", "Remind me in a week");
  remind.type = "button";
  remind.addEventListener("click", () => {
    downloadReminder(person);
    status.textContent = `Reminder for ${person.name} downloaded. Open it to add it to your calendar.`;
  });
  const remove = el("button", "sp-person-delete", "Delete");
  remove.type = "button";
  remove.setAttribute("aria-label", `Delete ${person.name}`);
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete ${person.name}? This can't be undone.`)) return;
    try {
      await store.remove(person.id);
      status.textContent = `${person.name} deleted.`;
      await refresh();
      nameInput.focus();
    } catch (err) {
      logger.warn("[Save] delete failed", err?.code);
      status.textContent = "Couldn’t delete. Check your connection and try again.";
    }
  });
  actions.append(remind, remove);
  li.append(actions);
  return li;
}

function render() {
  listEl.replaceChildren(...people.map(personCard));
  $("spPeople").hidden = people.length === 0;
  $("spPeopleHeading").textContent = people.length === 1 ? "Your people (1)" : `Your people (${people.length})`;
  $("spKeep").hidden = store.kind === "account" || people.length === 0;
}

async function refresh() {
  try {
    people = await store.list();
  } catch (err) {
    logger.warn("[Save] account list unavailable, using this device", err?.code);
    store = device;
    people = await device.list();
  }
  render();
}

form.addEventListener("input", (event) => {
  if (event.target === nameInput) updateSaveLabel();
  errorEl.hidden = true;
  savedMark.hidden = true;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const person = makePerson({ name: nameInput.value, where: whereInput.value, note: noteInput.value });
  if (!person) {
    errorEl.textContent = "Add their name to save them.";
    errorEl.hidden = false;
    nameInput.focus();
    return;
  }
  saveBtn.disabled = true;
  try {
    await store.add(person);
  } catch (err) {
    // Never lose what they typed: fall back to this device.
    logger.warn("[Save] account save failed, keeping on this device", err?.code);
    await device.add(person);
  } finally {
    saveBtn.disabled = false;
  }
  form.reset();
  updateSaveLabel();
  savedMark.hidden = false;
  status.textContent = `${person.name} saved.`;
  await refresh();
  nameInput.focus();
});

$("spCopy").addEventListener("click", async () => {
  const text = buildGuestRecap({
    people: people.map((p) => ({ name: p.name, savedAt: p.savedAt, memory: [p.where && `Met: ${p.where}`, p.note].filter(Boolean).join("\n") })),
  });
  const copyStatus = $("spCopyStatus");
  const fallback = $("spCopyFallback");
  if (!text) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
    fallback.hidden = true;
    copyStatus.textContent = "Recap copied. Paste it into your notes.";
  } catch (_) {
    fallback.value = text;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    copyStatus.textContent = "Copy isn’t available here. Your recap is selected below.";
  }
});

$("spSignIn").addEventListener("click", async () => {
  let supabase;
  try { ({ supabase } = await loadClient()); } catch (_) {
    status.textContent = "Sign-in isn’t available right now. Your people are still saved on this phone.";
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/save/" },
  });
  if (error) logger.error("[Save] sign-in failed:", error);
});

async function init() {
  updateSaveLabel();
  await refresh(); // this device's list, right away

  let supabase = null;
  let signedIn = false;
  try {
    const client = await loadClient();
    supabase = client.supabase;
    const { data } = await client.getSessionCached();
    signedIn = Boolean(data?.session?.user);
  } catch (_) { /* offline or CDN unavailable: stay on this device */ }

  if (signedIn) {
    const account = createAccountStore(supabase);
    try {
      await account.list(); // fails if the table isn't available yet
      const waiting = device.peek();
      if (waiting.length) {
        await account.importAll(waiting);
        device.clear();
        status.textContent = waiting.length === 1
          ? "1 person from this phone is now in your account."
          : `${waiting.length} people from this phone are now in your account.`;
      }
      store = account;
      $("spLede").textContent = "Their name and one thing to remember. Only you can see them.";
      $("spFine").textContent = "Saved to your account. Nearify never contacts the people you save here.";
    } catch (err) {
      logger.warn("[Save] account storage unavailable, using this device", err?.code);
    }
  }
  await refresh();
}

init();
