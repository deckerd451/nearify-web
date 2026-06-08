import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dedupeRequest } from "./supabaseLoad.js";
import { logger } from "./logger.js";

export const supabaseUrl = "https://unndeygygkgodmmdnlup.supabase.co";
export const supabaseKey = "sb_publishable_G0KAfCFTovYCWDeEEKWBfg_8UpPHWWZ";

const STORAGE_KEY = "nearify-auth";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: STORAGE_KEY },
});

const scopedClientCache = new Map();

export function createScopedSupabaseClient(headers = {}) {
  const headerScope = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}`)
    .join("|");

  if (scopedClientCache.has(headerScope)) return scopedClientCache.get(headerScope);

  const client = createClient(supabaseUrl, supabaseKey, {
    global: { headers },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Use a distinct storage key so supabase-js does not warn about multiple
      // GoTrueClient instances sharing the same key. The scoped client never
      // persists a session (persistSession: false), so the key is cosmetic only.
      storageKey: `${STORAGE_KEY}-scoped`,
    },
  });
  scopedClientCache.set(headerScope, client);
  return client;
}

let sessionPromise = null;
export function getSessionCached() {
  if (!sessionPromise) {
    sessionPromise = dedupeRequest("auth:getSession", () => supabase.auth.getSession())
      .finally(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

logger.log("[SupabaseLoad] client initialized", { storageKey: STORAGE_KEY });
window.supabase = supabase;
