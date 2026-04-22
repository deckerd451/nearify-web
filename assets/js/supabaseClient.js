import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabaseUrl = "https://unndeygygkgodmmdnlup.supabase.co";
export const supabaseKey = "sb_publishable_G0KAfCFTovYCWDeEEKWBfg_8UpPHWWZ";

export const supabase = createClient(supabaseUrl, supabaseKey);

export function createScopedSupabaseClient(headers = {}) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers },
  });
}

// Helpful for browser-console testing
window.supabase = supabase;

console.log("Nearify Supabase client initialized");
