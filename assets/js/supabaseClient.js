import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://unndeygygkgodmmdnlup.supabase.co";
const supabaseKey = "sb_publishable_G0KAfCFTovYCWDeEEKWBfg_8UpPHWWZ";

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helpful for browser-console testing
window.supabase = supabase;

console.log("Nearify Supabase client initialized");
