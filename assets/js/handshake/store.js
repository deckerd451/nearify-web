/**
 * Handshakes: everything lives in this browser's IndexedDB. The private
 * key is a CryptoKey object stored as-is; it never leaves the device
 * except inside a passphrase-protected backup the person downloads.
 */
import { emptyState } from "./protocol.js";

const DB = "nearify-handshakes";
const STORE = "state";
const KEY = "v1";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export async function loadState() {
  return (await run("readonly", (s) => s.get(KEY))) || emptyState();
}

export function saveState(state) {
  return run("readwrite", (s) => s.put(state, KEY));
}

export function deleteEverything() {
  return run("readwrite", (s) => s.delete(KEY));
}

/** Ask the browser not to clear this storage on its own. */
export async function askToKeep() {
  try { return (await navigator.storage?.persist?.()) || false; } catch (_) { return false; }
}
