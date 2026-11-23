/**
 * Handshakes and a Nearify account.
 *
 * Handshakes keeps people on this phone. A Nearify account is still used for
 * events. When someone is signed in, this lets Handshakes:
 *   - start their card from their Nearify profile (name, what they're building);
 *   - move people they saved to their account into this phone, then delete
 *     the account copies.
 * The Supabase client is only loaded for people who are signed in.
 */
import { LOCAL_PEOPLE_KEY, parsePeople, createAccountStore } from "../localPeople.js";

const AUTH_KEY = "nearify-auth";

function signedInHere() {
  try { return Boolean(localStorage.getItem(AUTH_KEY)); } catch (_) { return false; }
}

/** People saved on this browser with the old "Save someone" page. */
export function browserSaved() {
  try { return parsePeople(localStorage.getItem(LOCAL_PEOPLE_KEY)); } catch (_) { return []; }
}

export function clearBrowserSaved() {
  try { localStorage.removeItem(LOCAL_PEOPLE_KEY); } catch (_) { /* nothing to clear */ }
}

export async function connectAccount() {
  if (!signedInHere()) return null;
  try {
    const { supabase, getSessionCached } = await import("../supabaseClient.js");
    const { data } = await getSessionCached();
    const userId = data?.session?.user?.id;
    if (!userId) return null;
    const saved = createAccountStore(supabase);
    return {
      async profile() {
        const { data: row } = await supabase.from("profiles").select("name, building").eq("user_id", userId).maybeSingle();
        return row || null;
      },
      listSaved: () => saved.list(),
      removeSaved: (id) => saved.remove(id),
    };
  } catch (_) {
    return null;
  }
}
