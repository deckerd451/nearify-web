/**
 * Handshakes: who you've met, kept on this device.
 *
 * Statuses for a person:
 *   request   they scanned your card; you decide
 *   sent      you scanned their card; waiting for them
 *   connected you both agreed
 *   offered   someone you met wants to introduce you; you decide
 *   accepted  you said yes to an introduction; waiting for them
 *
 * Nothing is ever sent about a "no". Declining just forgets.
 *
 * "How to reach me" (state.me.reach) is never on the card someone scans.
 * It is sent, sealed, only to people you are connected with: with your
 * yes, or once both sides of an introduction have said yes.
 */
import { PUB_PATTERN, BOX_PATTERN, b64url, generateIdentity, inboxId, open, openFrom, randomId, seal, sealTo, sharedSecret } from "./crypto.js";
import { parseReach } from "../reach.js";

export const INVITE_MINUTES = 30;
const MAX_INVITES = 5;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export function cleanCard(card) {
  const name = String(card?.name ?? "").replace(CONTROL, "").trim().slice(0, 40);
  const building = String(card?.building ?? "").replace(CONTROL, "").trim().slice(0, 80);
  if (!name) return null;
  return building ? { name, building } : { name };
}

export function cleanReach(value) {
  return parseReach(String(value ?? "").replace(CONTROL, " "))?.value || "";
}

export function emptyState() {
  return { me: null, invites: [], people: {}, asks: { mine: {}, inbox: {}, relayed: {} } };
}

export async function setUp(state, card, reach = "") {
  const clean = cleanCard(card);
  if (!clean) throw new Error("Add your name first.");
  if (!state.me) {
    const id = await generateIdentity();
    state.me = { privateKey: id.privateKey, pub: id.pub, card: clean, reach: cleanReach(reach) };
  } else {
    state.me.card = clean;
  }
  return state;
}

const connected = (state) => Object.entries(state.people).filter(([, p]) => p.status === "connected").map(([pub]) => pub);

/** Change how people you're connected with can reach you, and tell them. */
export async function setReach(state, mailbox, value) {
  const reach = cleanReach(value);
  if (reach === (state.me.reach || "")) return 0;
  state.me.reach = reach;
  const pubs = connected(state);
  for (const pub of pubs) await sendTo(state, mailbox, pub, { t: "reach", reach });
  return pubs.length;
}

function withReach(message, state) {
  return state.me.reach ? { ...message, reach: state.me.reach } : message;
}

function connectedPerson(person, msg, now) {
  const reach = cleanReach(msg?.reach);
  return { card: person.card, status: "connected", ...(person.via ? { via: person.via } : {}), since: now, ...(reach ? { reach } : {}) };
}

const secrets = new Map();
async function secretWith(state, pub) {
  const key = state.me.pub + ":" + pub;
  if (!secrets.has(key)) secrets.set(key, sharedSecret(state.me.privateKey, pub));
  return secrets.get(key);
}

async function sendTo(state, mailbox, pub, message) {
  const secret = await secretWith(state, pub);
  await mailbox.post(await inboxId(secret, pub), await seal(secret, "link", message));
}

/** Make a new invite to show as a QR code. Returns the link. */
export function createInvite(state, origin, now = Date.now()) {
  const r = randomId();
  state.invites = [...state.invites.filter((i) => now - i.createdAt < INVITE_MINUTES * 60000), { r, createdAt: now }].slice(-MAX_INVITES);
  const params = new URLSearchParams({ v: "1", k: state.me.pub, r, n: state.me.card.name });
  return `${origin}/handshake/#${params}`;
}

export function parseInvite(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const k = params.get("k") || "";
  const r = params.get("r") || "";
  const card = cleanCard({ name: params.get("n") });
  if (params.get("v") !== "1" || !PUB_PATTERN.test(k) || !BOX_PATTERN.test(r) || !card) return null;
  return { pub: k, r, card };
}

/** I scanned someone's card and want to connect. */
export async function answerInvite(state, mailbox, invite, now = Date.now()) {
  if (invite.pub === state.me.pub) throw new Error("That's your own card.");
  const existing = state.people[invite.pub];
  if (existing?.status === "connected") return existing;
  await mailbox.post(invite.r, await sealTo(invite.pub, { pub: state.me.pub, card: state.me.card }));
  state.people[invite.pub] = { card: invite.card, status: "sent", since: now };
  return state.people[invite.pub];
}

export async function acceptRequest(state, mailbox, pub, now = Date.now()) {
  const person = state.people[pub];
  if (person?.status !== "request") return;
  await sendTo(state, mailbox, pub, withReach({ t: "accept" }, state));
  state.people[pub] = { card: person.card, status: "connected", since: now };
}

export function forget(state, pub) {
  delete state.people[pub];
}

/** Introduce two people I'm connected to. Each decides on their own. */
export async function introduce(state, mailbox, pubB, pubC, about = "") {
  const b = state.people[pubB];
  const c = state.people[pubC];
  if (pubB === pubC || b?.status !== "connected" || c?.status !== "connected") throw new Error("You can only introduce two people you're connected to.");
  const note = cleanAsk(about);
  await sendTo(state, mailbox, pubB, { t: "intro", pub: pubC, card: c.card, ...(note ? { about: note } : {}) });
  await sendTo(state, mailbox, pubC, { t: "intro", pub: pubB, card: b.card, ...(note ? { about: note } : {}) });
}

export async function acceptIntro(state, mailbox, pub, now = Date.now()) {
  const person = state.people[pub];
  if (person?.status !== "offered") return;
  if (person.theyAccepted) {
    // They already said yes, so this connects us: my reach can go with it.
    await sendTo(state, mailbox, pub, withReach({ t: "intro-accept" }, state));
    state.people[pub] = { card: person.card, status: "connected", via: person.via, since: now, ...(person.reach ? { reach: person.reach } : {}) };
  } else {
    await sendTo(state, mailbox, pub, { t: "intro-accept" });
    state.people[pub] = { ...person, status: "accepted" };
  }
}

const LISTENING = new Set(["sent", "connected", "offered", "accepted"]);

/** Collect and apply everything waiting. Returns true if anything changed. */
export async function check(state, mailbox, now = Date.now()) {
  state.invites = state.invites.filter((i) => now - i.createdAt < INVITE_MINUTES * 60000);
  expireAsks(state, now);
  const byBox = new Map(state.invites.map((i) => [i.r, { invite: true }]));
  for (const [pub, person] of Object.entries(state.people)) {
    if (!LISTENING.has(person.status)) continue;
    byBox.set(await inboxId(await secretWith(state, pub), state.me.pub), { pub });
  }
  if (!byBox.size) return false;
  const messages = await mailbox.take([...byBox.keys()]);
  let changed = false;
  for (const { box, payload } of messages) {
    const source = byBox.get(box);
    if (!source) continue;
    try {
      changed = (source.invite ? await applyRequest(state, mailbox, payload, now) : await applyLink(state, mailbox, source.pub, payload, now)) || changed;
    } catch (_) { /* Unreadable or forged messages are dropped. */ }
  }
  return changed;
}

async function applyRequest(state, mailbox, payload, now) {
  const msg = await openFrom(state.me.privateKey, payload);
  const card = cleanCard(msg?.card);
  if (!PUB_PATTERN.test(msg?.pub || "") || !card || msg.pub === state.me.pub) return false;
  const existing = state.people[msg.pub];
  if (existing?.status === "connected") return false;
  if (existing?.status === "sent") {
    // We scanned each other's cards: both of us already said yes.
    await sendTo(state, mailbox, msg.pub, withReach({ t: "accept" }, state));
    state.people[msg.pub] = { card: existing.card, status: "connected", since: now };
    return true;
  }
  state.people[msg.pub] = { card, status: "request", since: now };
  return true;
}

async function applyLink(state, mailbox, pub, payload, now) {
  const msg = await open(await secretWith(state, pub), "link", payload);
  const person = state.people[pub];
  if (!person) return false;
  if (msg?.t === "accept" && person.status === "sent") {
    state.people[pub] = connectedPerson(person, msg, now);
    if (state.me.reach) await sendTo(state, mailbox, pub, { t: "reach", reach: state.me.reach });
    return true;
  }
  if ((msg?.t === "reach" || msg?.t === "accept") && person.status === "connected") {
    const reach = cleanReach(msg.reach);
    if (msg.t === "accept" && !reach) return false;
    if (reach === (person.reach || "")) return false;
    const { reach: _old, ...rest } = person;
    state.people[pub] = reach ? { ...rest, reach } : rest;
    return true;
  }
  if (msg?.t === "intro-accept") {
    if (person.status === "accepted") {
      state.people[pub] = connectedPerson(person, msg, now);
      if (state.me.reach) await sendTo(state, mailbox, pub, { t: "reach", reach: state.me.reach });
      return true;
    }
    if (person.status === "offered" && !person.theyAccepted) {
      state.people[pub] = { ...person, theyAccepted: true };
      return true;
    }
    return false;
  }
  if (typeof msg?.t === "string" && msg.t.startsWith("ask")) {
    return person.status === "connected" ? applyAsk(state, mailbox, pub, msg, now) : false;
  }
  if (msg?.t === "intro" && person.status === "connected") {
    const card = cleanCard(msg.card);
    if (!PUB_PATTERN.test(msg.pub || "") || !card || msg.pub === state.me.pub || msg.pub === pub) return false;
    const existing = state.people[msg.pub];
    if (existing && existing.status !== "offered") return false;
    const about = cleanAsk(msg.about);
    state.people[msg.pub] = { card, status: "offered", via: { pub, name: person.card.name }, since: now, ...(about ? { about } : {}), ...(existing?.theyAccepted ? { theyAccepted: true } : {}) };
    return true;
  }
  return false;
}

// ── Asks ─────────────────────────────────────────────────────────────────────
//
// An ask ("I need someone who knows embedded hardware") goes to the people
// you're connected with. Each of them can offer to help, or pass it on to
// people *they* are connected with: one step further, never more. Someone
// two steps away sees only "someone Ben met asks", never your name. If they
// can help, Ben is told and can introduce you, which you both still have to
// accept. Nothing about an ask touches the server unsealed.

export const ASK_MAX = 140;
export const ASK_DAYS = 14;
const ASK_ID = /^[A-Za-z0-9_-]{22}$/;

export function cleanAsk(text) {
  return String(text ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, ASK_MAX).trim();
}

function asksOf(state) {
  state.asks ||= {};
  state.asks.mine ||= {};
  state.asks.inbox ||= {};
  state.asks.relayed ||= {};
  return state.asks;
}

function expireAsks(state, now) {
  const a = asksOf(state);
  const old = (t) => now - t > ASK_DAYS * 86400000;
  for (const [id, x] of Object.entries(a.mine)) if (old(x.createdAt)) delete a.mine[id];
  for (const [id, x] of Object.entries(a.inbox)) if (old(x.receivedAt)) delete a.inbox[id];
  for (const [id, x] of Object.entries(a.relayed)) if (old(x.createdAt)) delete a.relayed[id];
}

/** Send an ask to everyone you're connected with. Returns how many. */
export async function sendAsk(state, mailbox, text, now = Date.now()) {
  const clean = cleanAsk(text);
  if (!clean) throw new Error("Write what you're looking for first.");
  const to = connected(state);
  if (!to.length) throw new Error("Connect with someone first. Asks only go to people you've met.");
  const id = b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  asksOf(state).mine[id] = { text: clean, createdAt: now, to, helpers: [] };
  for (const pub of to) await sendTo(state, mailbox, pub, { t: "ask", id, text: clean, hop: 1 });
  return to.length;
}

export async function closeAsk(state, mailbox, id) {
  const mine = asksOf(state).mine[id];
  if (!mine) return;
  for (const pub of mine.to) if (state.people[pub]?.status === "connected") await sendTo(state, mailbox, pub, { t: "ask-close", id });
  delete asksOf(state).mine[id];
}

export async function offerHelp(state, mailbox, id) {
  const item = asksOf(state).inbox[id];
  if (!item || item.helped || state.people[item.from]?.status !== "connected") return;
  await sendTo(state, mailbox, item.from, { t: "ask-help", id });
  item.helped = true;
}

/** Pass an ask you received directly to someone else you're connected with. */
export async function passOn(state, mailbox, id, toPub, now = Date.now()) {
  const a = asksOf(state);
  const item = a.inbox[id];
  if (!item || item.hop !== 1) throw new Error("This ask can't be passed on any further.");
  if (toPub === item.from || state.people[toPub]?.status !== "connected") throw new Error("You can only pass it to someone you're connected with.");
  if (item.passedTo.includes(toPub)) return;
  await sendTo(state, mailbox, toPub, { t: "ask", id, text: item.text, hop: 2 });
  item.passedTo.push(toPub);
  const relay = (a.relayed[id] ||= { origin: item.from, text: item.text, createdAt: now, to: [], offers: [], introduced: [] });
  relay.to.push(toPub);
}

export function dismissAsk(state, id) {
  delete asksOf(state).inbox[id];
}

/** Someone you passed an ask to can help: introduce them to the person who asked. */
export async function introduceHelper(state, mailbox, id, helperPub) {
  const relay = asksOf(state).relayed[id];
  if (!relay?.offers.includes(helperPub) || relay.introduced.includes(helperPub)) return;
  await introduce(state, mailbox, relay.origin, helperPub, relay.text);
  relay.introduced.push(helperPub);
}

async function applyAsk(state, mailbox, pub, msg, now) {
  const a = asksOf(state);
  const id = String(msg.id || "");
  if (!ASK_ID.test(id)) return false;
  if (msg.t === "ask") {
    const text = cleanAsk(msg.text);
    if (!text || (msg.hop !== 1 && msg.hop !== 2) || a.inbox[id] || a.mine[id]) return false;
    a.inbox[id] = { text, from: pub, hop: msg.hop, receivedAt: now, passedTo: [] };
    return true;
  }
  if (msg.t === "ask-help") {
    const mine = a.mine[id];
    if (mine?.to.includes(pub)) {
      if (mine.helpers.includes(pub)) return false;
      mine.helpers.push(pub);
      return true;
    }
    const relay = a.relayed[id];
    if (relay?.to.includes(pub) && !relay.offers.includes(pub)) {
      relay.offers.push(pub);
      return true;
    }
    return false;
  }
  if (msg.t === "ask-close") {
    let changed = false;
    if (a.inbox[id]?.from === pub) { delete a.inbox[id]; changed = true; }
    const relay = a.relayed[id];
    if (relay?.origin === pub) {
      for (const to of relay.to) if (state.people[to]?.status === "connected") await sendTo(state, mailbox, to, { t: "ask-close", id });
      delete a.relayed[id];
      changed = true;
    }
    return changed;
  }
  return false;
}
