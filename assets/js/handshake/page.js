/**
 * /handshake/ — meet someone, tap Connect, and only then can you reach
 * each other. Introductions need both people to say yes.
 * All text is set with textContent; nothing from a card is parsed as HTML.
 */
import * as P from "./protocol.js";
import { encryptBackup, decryptBackup } from "./crypto.js";
import { mailbox } from "./mailbox.js";
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
      button("Connect", () => P.acceptRequest(state, mailbox, pub), `You and ${person.card.name} are connected.`, true),
      button("Not now", async () => P.forget(state, pub), "Forgotten. They aren't told."),
    );
  } else if (person.status === "offered") {
    row.prepend(el("p", { class: "hs-kicker", text: `${person.via.name} wants to introduce you` + (person.theyAccepted ? " · they've said yes" : "") }));
    actions.append(
      button("Say yes", () => P.acceptIntro(state, mailbox, pub), person.theyAccepted ? `You and ${person.card.name} are connected.` : `Sent. You'll be connected if ${person.card.name} says yes too.`, true),
      button("No thanks", async () => P.forget(state, pub), "Declined. Nobody is told."),
    );
  } else if (person.status === "sent" || person.status === "accepted") {
    row.prepend(el("p", { class: "hs-kicker", text: `Waiting for ${person.card.name} to say yes` }));
    actions.append(button("Cancel", async () => P.forget(state, pub), "Cancelled."));
  } else {
    row.prepend(el("p", { class: "hs-kicker", text: person.via ? `Introduced by ${person.via.name}` : "Met in person" }));
    const others = Object.entries(state.people).filter(([p, o]) => p !== pub && o.status === "connected");
    if (others.length) {
      const select = el("select", { class: "hs-select", "aria-label": `Introduce ${person.card.name} to` },
        el("option", { value: "", text: `Introduce ${person.card.name} to…` }),
        ...others.map(([p, o]) => el("option", { value: p, text: o.card.name })));
      const send = el("button", { type: "button", class: "hs-btn", text: "Send", disabled: true });
      select.addEventListener("change", () => { send.disabled = !select.value; });
      send.addEventListener("click", () => {
        const other = state.people[select.value];
        if (other) act(() => P.introduce(state, mailbox, pub, select.value), `Introduction sent. ${person.card.name} and ${other.card.name} each decide.`);
      });
      actions.append(select, send);
    }
  }
  row.append(actions);
  return row;
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
  $("hsList").replaceChildren(...entries.map(([pub, p]) => personRow(pub, p)));
  $("hsEmpty").hidden = entries.length > 0;
  const count = entries.filter(([, p]) => p.status === "connected").length;
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
  const file = await encryptBackup(pass, state.me.privateKey, { pub: state.me.pub, card: state.me.card, people: state.people });
  const a = el("a", { href: URL.createObjectURL(new Blob([file], { type: "application/json" })), download: "nearify-handshakes-backup.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("hsPass").value = "";
  say("Backup saved. Keep the file and the passphrase somewhere safe.");
}

async function restore() {
  const file = $("hsRestoreFile").files?.[0];
  if (!file) return say("Choose your backup file first.");
  try {
    const { privateKey, data } = await decryptBackup($("hsPass").value, await file.text());
    state = { me: { privateKey, pub: data.pub, card: data.card }, invites: [], people: data.people || {} };
    await saveState(state);
    $("hsPass").value = "";
    newInvite();
    say("Restored.");
  } catch (_) {
    say("That passphrase doesn't open this backup.");
  }
  render();
}

async function start() {
  state = await loadState();
  if (location.hash) {
    pendingInvite = P.parseInvite(location.hash);
    // Take the invite out of the address bar and history straight away.
    history.replaceState(null, "", location.pathname);
    if (!pendingInvite) say("That code didn't work. Ask them to show a new one.");
  }

  $("hsSetupForm").addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => {
      await P.setUp(state, { name: $("hsName").value, building: $("hsBuilding").value });
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

  if (state.me) { newInvite(); await saveState(state); }
  render();
  poll();
}

start();
