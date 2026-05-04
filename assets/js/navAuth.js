/**
 * navAuth.js — Navigation auth state indicator.
 * Stub — provides the module expected by page script tags.
 */

import { supabase } from "./supabaseClient.js";

async function initNavAuth() {
  // Future: show signed-in state in nav
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    console.log("[NavAuth] signed in:", data.session.user.email);
  }
}

initNavAuth().catch(() => {});
