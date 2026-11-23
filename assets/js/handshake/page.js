/**
 * /handshake/ — meet someone, tap Connect, and only then can you reach
 * each other. Introductions need both people to say yes.
 * All text is set with textContent; nothing from a card is parsed as HTML.
 */
import * as P from "./protocol.js";
import { encryptBackup, decryptBackup } from "./crypto.js";
import { mailbox, count } from "./mailbox.js";
import { buildVCard, reachActions, vCardFileName } from "../reach.js";
import { browserSaved, clearBrowserSaved, connectAccount } from "./account.js";
import { loadState, saveState, deleteEverything, askToKeep } from "./store.js";

const $ = (id) => document.getElementById(id);
let state;
let pendingInvite = null;
let inviteLink = "";
let timer = null;
let busy = false;

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids) if (kid) node.append(kid);
  return node;
}

function say(text) { $("hsStatus").textContent = text; }

async function act(fn, done) {
  if (busy) return;
  busy = true;
  try {
    await fn();
    await saveState(state);
    if (done) say(done);
  } catch (err) {
    say(err?.message?.startsWith("Mailbox") ? "Couldn't reach the server. Check your connection and try again." : err.message || "Something went wrong.");
  } finally {
    busy = false;
    render();
  }
}

function personRow(pub, person) {
  const row = el("li", { class: "nf-paper hs-person" });
  row.append(el("p", { class: "nf-name hs-person-name", text: person.card.name }));
  if (person.card.building) row.append(el("p", { class: "hs-person-building", text: person.card.building }));
  const actions = el("div", { class: "hs-actions" });
  const button = (label, fn, done, primary) => el("button", { type: "button", class: primary ? "hs-btn hs-btn-primary" : "hs-btn", text: label, on: { click: () => act(fn, done) } });

  if (person.status === "request") {
    row.prepend(el("p", { class: "hs-kicker", text: "Scanned your card" }));
    actions.append(
      button("Connect", async () => { await P.acceptRequest(state, mailbox, pub); count("connected"); }, `You and ${person.card.name} are connected.`, true),
      button("Not now", async () => P.forget(state, pub), "Forgotten. They aren't told."),
    );
  } else if (person.status === "offered") {
    row.prepend(el("p", { class: "hs-kicker", text: `${person.via.name} wants to introduce you` + (person.theyAccepted ? " · they've said yes" : "") }));
    if (person.about) row.append(el("p", { class: "hs-about", text: `About: ${person.about}` }));
    actions.append(
      button("Say yes", async () => { const both = person.theyAccepted; await P.acceptIntro(state, mailbox, pub); if (both) count("connected"); }, person.theyAccepted ? `You and ${person.card.name} are connected.` : `Sent. You'll be connected if ${person.card.name} says yes too.`, true),
      button("No thanks", async () => P.forget(state, pub), "Declined. Nobody is told."),
    );
  } else if (person.status === "sent" || person.status === "accepted") {
    row.prepend(el("p", { class: "hs-kicker", text: `Waiting for ${person.card.name} to say yes` }));
    actions.append(button("Cancel", async () => P.forget(state, pub), "Cancelled."));
  } else {
    row.prepend(el("p", { class: "hs-kicker", text: person.via ? `Introduced by ${person.via.name}` : "Met in person" }));
    row.append(el("div", { class: "hs-actions hs-remove-row" }, el("button", { type: "button", class: "hs-link", text: "Remove", on: { click: () => {
      if (!confirm(`Remove ${person.card.name}? They aren't told, and they can no longer reach you here.`)) return;
      act(async () => P.forget(state, pub), `Removed ${person.card.name}. They weren't told.`);
    } } })));
    if (person.reach) {
      row.append(el("p", { class: "hs-reach", text: person.reach }));
      row.append(contactActions(contactFor(person)));
    }
    const others = Object.entries(state.people).filter(([p, o]) => p !== pub && o.status === "connected");
    if (others.length) {
      const select = el("select", { class: "hs-select", "aria-label": `Introduce ${person.card.name} to` },
        el("option", { value: "", text: `Introduce ${person.card.name} to…` }),
        ...others.map(([p, o]) => el("option", { value: p, text: o.card.name })));
      const send = el("button", { type: "button", class: "hs-btn", text: "Send", disabled: true });
      select.addEventListener("change", () => { send.disabled = !select.value; });
      send.addEventListener("click", () => {
        const other = state.people[select.value];
        const to = select.value;
        if (other) act(async () => { await P.introduce(state, mailbox, pub, to); count("intro_sent"); }, `Introduction sent. ${person.card.name} and ${other.card.name} each decide.`);
      });
      actions.append(select, send);
    }
  }
  row.append(actions);
  return row;
}

function contactFor(person) {
  return {
    name: person.card.name,
    reach: person.reach,
    where: person.via ? `introduced by ${person.via.name}, through Nearify Handshakes` : "in person, through Nearify Handshakes",
    note: person.card.building ? `Building: ${person.card.building}` : "",
  };
}

function download(text, type, fileName) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function contactActions(contact) {
  const quick = el("div", { class: "hs-actions" });
  for (const action of reachActions(contact, { myName: state.me.card.name })) {
    const link = el("a", { class: action.primary ? "hs-btn hs-btn-primary" : "hs-btn", href: action.href, text: action.label });
    if (action.external) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
    quick.append(link);
  }
  quick.append(el("button", { type: "button", class: "hs-btn", text: "Add to Contacts", on: { click: () => {
    download(buildVCard(contact), "text/vcard;charset=utf-8", vCardFileName(contact));
    count("contact_saved");
    say(`Contact card for ${contact.name} downloaded. Open it to add them to your contacts.`);
  } } }));
  return quick;
}

function noteRow(id, note) {
  const row = el("li", { class: "nf-paper hs-person hs-note-row" });
  row.append(el("p", { class: "hs-kicker", text: "Not on Nearify · only you can see this" }), el("p", { class: "nf-name hs-person-name", text: note.name }));
  if (note.where) row.append(el("p", { class: "hs-person-building", text: `Met ${note.where}` }));
  if (note.note) row.append(el("p", { class: "hs-ask-text", text: note.note }));
  if (note.reach) {
    row.append(el("p", { class: "hs-reach", text: note.reach }));
    row.append(contactActions({ name: note.name, reach: note.reach, where: note.where || "", note: note.note || "" }));
  }
  row.append(el("div", { class: "hs-actions hs-remove-row" }, el("button", { type: "button", class: "hs-link", text: "Remove", on: { click: () => {
    if (confirm(`Remove your note about ${note.name}?`)) act(async () => P.removeNote(state, id), "Note removed.");
  } } })));
  return row;
}

function fillEdit() {
  $("hsEditName").value = state.me.card.name;
  $("hsEditBuilding").value = state.me.card.building || "";
  $("hsEditReach").value = state.me.reach || "";
}

const nameOf = (pub) => state.people[pub]?.card.name || "Someone";
const connectedPubs = () => Object.entries(state.people).filter(([, p]) => p.status === "connected").map(([pub]) => pub);

function askRow(kicker, text) {
  const row = el("li", { class: "nf-paper hs-person hs-ask" });
  row.append(el("p", { class: "hs-kicker", text: kicker }), el("p", { class: "hs-ask-text", text }));
  return row;
}

function askButton(label, fn, done, primary) {
  return el("button", { type: "button", class: primary ? "hs-btn hs-btn-primary" : "hs-btn", text: label, on: { click: () => act(fn, done) } });
}

function renderAsks() {
  const asks = state.asks || { mine: {}, inbox: {}, relayed: {} };
  const people = connectedPubs();
  const rows = [];

  for (const [id, item] of Object.entries(asks.inbox).sort(([, x], [, y]) => y.receivedAt - x.receivedAt)) {
    const who = nameOf(item.from);
    const row = askRow(item.hop === 1 ? `${who} asks` : `Someone ${who} met asks`, item.text);
    const actions = el("div", { class: "hs-actions" });
    if (item.helped) {
      actions.append(el("p", { class: "hs-done", text: item.hop === 1 ? `You told ${who} you can help.` : `${who} knows you can help and can introduce you.` }));
    } else {
      actions.append(askButton("I can help", async () => { await P.offerHelp(state, mailbox, id); count("help_offered"); }, item.hop === 1 ? `${who} will see that you can help.` : `${who} will see that you can help, and can introduce you.`, true));
    }
    actions.append(askButton("Dismiss", async () => P.dismissAsk(state, id), "Dismissed. Nobody is told."));
    row.append(actions);
    const targets = item.hop === 1 ? people.filter((p) => p !== item.from && !item.passedTo.includes(p)) : [];
    if (targets.length) {
      const pass = el("div", { class: "hs-actions" });
      const select = el("select", { class: "hs-select", "aria-label": "Pass this ask on to" },
        el("option", { value: "", text: "Pass it on to…" }), ...targets.map((p) => el("option", { value: p, text: nameOf(p) })));
      const send = el("button", { type: "button", class: "hs-btn", text: "Pass on", disabled: true });
      select.addEventListener("change", () => { send.disabled = !select.value; });
      send.addEventListener("click", () => {
        const to = select.value;
        act(async () => { await P.passOn(state, mailbox, id, to); count("ask_passed"); }, `Passed on to ${nameOf(to)}, without ${who}'s name.`);
      });
      pass.append(select, send);
      row.append(pass);
    }
    if (item.passedTo.length) row.append(el("p", { class: "hs-done", text: `Passed on to ${item.passedTo.map(nameOf).join(", ")}.` }));
    rows.push(row);
  }

  for (const [id, relay] of Object.entries(asks.relayed)) {
    if (!relay.offers.length) continue;
    const asker = nameOf(relay.origin);
    const row = askRow(`You passed on ${asker}'s ask`, relay.text);
    for (const helper of relay.offers) {
      const line = el("div", { class: "hs-actions" });
      line.append(el("p", { class: "hs-done", text: `${nameOf(helper)} can help.` }));
      if (relay.introduced.includes(helper)) line.append(el("p", { class: "hs-done", text: "Introduced." }));
      else line.append(askButton(`Introduce ${nameOf(helper)} and ${asker}`, async () => { await P.introduceHelper(state, mailbox, id, helper); count("intro_sent"); }, `Introduction sent. ${nameOf(helper)} and ${asker} each decide.`, true));
      row.append(line);
    }
    rows.push(row);
  }

  for (const [id, mine] of Object.entries(asks.mine).sort(([, x], [, y]) => y.createdAt - x.createdAt)) {
    const sentTo = mine.to.length === 1 ? "1 person" : `${mine.to.length} people`;
    const row = askRow(`Your ask · sent to ${sentTo}`, mine.text);
    row.append(el("p", { class: "hs-done", text: mine.helpers.length ? `Can help: ${mine.helpers.map(nameOf).join(", ")}. They're in your people below.` : "No offers yet. People can also pass it on, and you'll get an introduction if someone further out can help." }));
    row.append(el("div", { class: "hs-actions" }, askButton("Close ask", () => P.closeAsk(state, mailbox, id), "Ask closed. It's removed for everyone who had it.")));
    rows.push(row);
  }

  $("hsAskList").replaceChildren(...rows);
  $("hsAsks").hidden = !people.length && !rows.length;
  $("hsAskForm").hidden = !people.length;
}

function renderQr() {
  const box = $("hsQr");
  box.replaceChildren();
  if (!inviteLink || typeof window.QRCode !== "function") return;
  new window.QRCode(box, { text: inviteLink, width: 220, height: 220, colorDark: "#1a1633", colorLight: "#f3f0ff", correctLevel: window.QRCode.CorrectLevel.M });
  box.setAttribute("aria-label", `QR code to connect with ${state.me.card.name}`);
}

function render() {
  const ready = !!state?.me;
  $("hsSetupForm").hidden = ready;
  $("hsMain").hidden = !ready;
  const invite = $("hsInvite");
  invite.hidden = !pendingInvite;
  if (pendingInvite) {
    $("hsInviteName").textContent = pendingInvite.card.name;
    $("hsInviteGo").textContent = ready ? `Connect with ${pendingInvite.card.name}` : "Make my card and connect";
  }
  if (!ready) return;
  $("hsMyName").textContent = state.me.card.name;
  $("hsMyBuilding").textContent = state.me.card.building || "";
  const order = { request: 0, offered: 1, sent: 2, accepted: 2, connected: 3 };
  const entries = Object.entries(state.people).sort(([, a], [, b]) => order[a.status] - order[b.status] || b.since - a.since);
  const notes = Object.entries(state.notes || {}).sort(([, a], [, b]) => b.savedAt - a.savedAt);
  $("hsList").replaceChildren(...entries.map(([pub, p]) => personRow(pub, p)), ...notes.map(([id, n]) => noteRow(id, n)));
  $("hsEmpty").hidden = entries.length + notes.length > 0;
  renderAsks();
  const count = entries.filter(([, p]) => p.status === "connected").length + notes.length;
  $("hsCount").textContent = count === 1 ? "1 person you've met" : `${count} people you've met`;
}

function newInvite() {
  inviteLink = P.createInvite(state, location.origin);
  renderQr();
}

async function poll() {
  clearTimeout(timer);
  if (state?.me && !document.hidden && !busy) {
    try {
      if (await P.check(state, mailbox)) { await saveState(state); say(""); render(); }
    } catch (_) { /* offline: try again later */ }
  }
  const waiting = state?.invites?.length || Object.values(state?.people || {}).some((p) => p.status === "sent" || p.status === "accepted");
  timer = setTimeout(poll, waiting ? 4000 : 20000);
}

async function backup() {
  const pass = $("hsPass").value;
  if (pass.length < 8) return say("Use a passphrase of at least 8 characters.");
  const file = await encryptBackup(pass, state.me.privateKey, { pub: state.me.pub, card: state.me.card, reach: state.me.reach || "", people: state.people, asks: state.asks, notes: state.notes || {} });
  download(file, "application/json", "nearify-handshakes-backup.json");
  $("hsPass").value = "";
  say("Backup saved. Keep the file and the passphrase somewhere safe.");
}

async function restore() {
  const file = $("hsRestoreFile").files?.[0];
  if (!file) return say("Choose your backup file first.");
  try {
    const { privateKey, data } = await decryptBackup($("hsPass").value, await file.text());
    state = { me: { privateKey, pub: data.pub, card: data.card, reach: data.reach || "" }, invites: [], people: data.people || {}, asks: data.asks || { mine: {}, inbox: {}, relayed: {} }, notes: data.notes || {} };
    fillEdit();
    await saveState(state);
    $("hsPass").value = "";
    newInvite();
    say("Restored.");
  } catch (_) {
    say("That passphrase doesn't open this backup.");
  }
  render();
}

function readInvite() {
  if (!location.hash) return;
  pendingInvite = P.parseInvite(location.hash);
  // Take the invite out of the address bar and history straight away.
  history.replaceState(null, "", location.pathname);
  if (!pendingInvite) say("That code didn't work. Ask them to show a new one.");
}

let account = null;

/** Brings people from the old "Save someone" page in this browser into Handshakes. */
async function moveBrowserSaved() {
  const saved = browserSaved();
  if (!saved.length) return;
  const moved = P.importSaved(state, saved);
  await saveState(state);
  clearBrowserSaved();
  if (moved) say(`${moved === 1 ? "1 person" : `${moved} people`} you saved earlier ${moved === 1 ? "is" : "are"} now here, in this browser only.`);
}

async function renderAccount() {
  const box = $("hsAccount");
  if (!account) { box.hidden = true; return; }
  let saved = [];
  try { saved = await account.listSaved(); } catch (_) { /* table missing or offline */ }
  const parts = [];
  if (saved.length) {
    const label = saved.length === 1 ? "1 person" : `${saved.length} people`;
    parts.push(el("p", { class: "hs-note", text: `You have ${label} saved to your Nearify account. Move them here so everything about the people you know stays on your phone.` }));
    parts.push(el("div", { class: "hs-actions" }, el("button", { type: "button", class: "hs-btn hs-btn-primary", text: `Move ${label} here`, on: { click: () => {
      if (!confirm(`Move ${label} into this browser and delete them from your Nearify account? Afterwards they're kept only here, so download a backup if you switch phones.`)) return;
      act(async () => {
        P.importSaved(state, saved);
        await saveState(state);
        for (const person of saved) await account.removeSaved(person.id);
        renderAccount();
      }, `Moved ${label} here and deleted them from your account.`);
    } } })));
  }
  parts.push(el("p", { class: "hs-note" }, "People you're connected with through events are in ", el("a", { href: "/connections/", class: "hs-inline-link", text: "Event connections" }), "."));
  box.replaceChildren(...parts);
  box.hidden = false;
}

async function start() {
  state = await loadState();
  await moveBrowserSaved();
  readInvite();
  window.addEventListener("hashchange", () => { readInvite(); render(); });

  $("hsSetupForm").addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => {
      await P.setUp(state, { name: $("hsName").value, building: $("hsBuilding").value }, $("hsReach").value);
      count("card_made");
      fillEdit();
      askToKeep();
      newInvite();
      if (pendingInvite) {
        const invite = pendingInvite;
        await P.answerInvite(state, mailbox, invite);
        pendingInvite = null;
        say(`Sent. You'll be connected when ${invite.card.name} says yes.`);
      }
    });
  });
  $("hsInviteGo").addEventListener("click", () => {
    if (!state.me) { $("hsName").focus(); return say("Add your name below first."); }
    const invite = pendingInvite;
    act(async () => { await P.answerInvite(state, mailbox, invite); pendingInvite = null; }, `Sent. You'll be connected when ${invite.card.name} says yes.`);
  });
  $("hsNoteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => {
      const name = $("hsNoteName").value;
      P.addNote(state, { name, where: $("hsNoteWhere").value, note: $("hsNoteText").value, reach: $("hsNoteReach").value });
      for (const id of ["hsNoteName", "hsNoteWhere", "hsNoteText", "hsNoteReach"]) $(id).value = "";
      $("hsAddNote").open = false;
      say(`Saved ${name.trim()}. Only you can see this.`);
    });
  });
  $("hsAskForm").addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => {
      const sent = await P.sendAsk(state, mailbox, $("hsAskText").value);
      count("ask_sent");
      $("hsAskText").value = "";
      say(`Ask sent to ${sent === 1 ? "1 person" : `${sent} people`} you've met.`);
    });
  });
  $("hsEditForm").addEventListener("submit", (e) => {
    e.preventDefault();
    let shared = 0;
    act(async () => {
      await P.setUp(state, { name: $("hsEditName").value, building: $("hsEditBuilding").value });
      shared = await P.setReach(state, mailbox, $("hsEditReach").value);
      newInvite();
      fillEdit();
      say(shared ? `Saved. How to reach you was updated for ${shared === 1 ? "1 person" : `${shared} people`} you're connected with.` : "Saved.");
    });
  });
  $("hsNewCode").addEventListener("click", () => act(async () => newInvite(), "New code ready. The old one stops working in 30 minutes."));
  $("hsBackup").addEventListener("click", () => act(backup));
  $("hsRestore").addEventListener("click", () => restore());
  $("hsDelete").addEventListener("click", async () => {
    if (!confirm("Delete your card and everyone you've connected with from this browser? This can't be undone.")) return;
    await deleteEverything();
    state = P.emptyState();
    inviteLink = "";
    render();
    say("Everything was deleted from this browser.");
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

  if (state.me) { newInvite(); fillEdit(); await saveState(state); }
  render();
  poll();
  account = await connectAccount();
  if (account) {
    if (!state.me) {
      const profile = await account.profile().catch(() => null);
      if (profile?.name && !$("hsName").value) $("hsName").value = profile.name;
      if (profile?.building && !$("hsBuilding").value) $("hsBuilding").value = profile.building;
    }
    renderAccount();
  }
}

start();
