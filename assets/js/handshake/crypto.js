/**
 * Handshakes: cryptography. WebCrypto only, no dependencies.
 *
 * Every pair of people who met share a secret worked out from their two
 * keys (ECDH P-256). From it come the keys that seal their messages and
 * the mailbox ids they use. The server sees only random-looking ids and
 * sealed bytes; it never sees a name, a public key, or who met whom.
 */
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" };

export const PUB_PATTERN = /^[A-Za-z0-9_-]{87}$/; // 65 raw bytes
export const BOX_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes

export function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text) {
  const s = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomId() {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export async function generateIdentity() {
  const pair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  return { privateKey: pair.privateKey, pub: b64url(await subtle.exportKey("raw", pair.publicKey)) };
}

async function importPub(pub) {
  if (!PUB_PATTERN.test(pub)) throw new Error("bad key");
  return subtle.importKey("raw", fromB64url(pub), ECDH, false, []);
}

/** Raw shared secret between my private key and their public key. */
export async function sharedSecret(privateKey, theirPub) {
  const bits = await subtle.deriveBits({ name: "ECDH", public: await importPub(theirPub) }, privateKey, 256);
  return subtle.importKey("raw", bits, "HKDF", false, ["deriveBits", "deriveKey"]);
}

const hkdf = (info) => ({ name: "HKDF", hash: "SHA-256", salt: enc.encode("nearify-handshake-v1"), info: enc.encode(info) });

/** Mailbox id for messages to `recipientPub` on this pair's link. */
export async function inboxId(secret, recipientPub) {
  return b64url(await subtle.deriveBits(hkdf("inbox:" + recipientPub), secret, 256));
}

async function sealKey(secret, label) {
  return subtle.deriveKey(hkdf("seal:" + label), secret, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(secret, label, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(secret, label), enc.encode(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64url(out);
}

export async function open(secret, label, sealed) {
  const bytes = fromB64url(sealed);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await sealKey(secret, label), bytes.slice(12));
  return JSON.parse(dec.decode(pt));
}

/** Seal to someone's public key with a one-time key (used for the first reply to an invite). */
export async function sealTo(theirPub, value) {
  const eph = await generateIdentity();
  const secret = await sharedSecret(eph.privateKey, theirPub);
  return eph.pub + "." + (await seal(secret, "invite", value));
}

export async function openFrom(privateKey, sealed) {
  const [ephPub, body] = String(sealed).split(".");
  const secret = await sharedSecret(privateKey, ephPub);
  return open(secret, "invite", body);
}

/** Passphrase-protected backup of the private key and contacts. */
export async function encryptBackup(passphrase, privateKey, data) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const base = await subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const body = JSON.stringify({ jwk: await subtle.exportKey("jwk", privateKey), data });
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(body));
  return JSON.stringify({ nearifyHandshakeBackup: 1, salt: b64url(salt), iv: b64url(iv), ct: b64url(ct) });
}

export async function decryptBackup(passphrase, text) {
  const file = JSON.parse(text);
  if (file.nearifyHandshakeBackup !== 1) throw new Error("not a backup");
  const base = await subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "PBKDF2", salt: fromB64url(file.salt), iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: fromB64url(file.iv) }, key, fromB64url(file.ct));
  const { jwk, data } = JSON.parse(dec.decode(pt));
  const privateKey = await subtle.importKey("jwk", jwk, ECDH, true, ["deriveBits"]);
  return { privateKey, data };
}
