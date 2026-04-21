import { supabase } from "./supabaseClient.js";

function getBaseUrl() {
  return window.location.origin;
}

export function buildPersonalConnectUrl(eventId, profileId) {
  if (!eventId || !profileId) return null;
  const url = new URL("/join/", getBaseUrl());
  url.searchParams.set("event", eventId);
  url.searchParams.set("profile", profileId);
  return url.toString();
}

export async function getMyProfileId() {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;

  const userId = authData?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export function renderPersonalConnectQr(containerEl, url) {
  if (!containerEl || !url) return;
  containerEl.innerHTML = "";

  if (typeof window.QRCode !== "function") {
    console.warn("[PersonalConnect] QRCode library not available");
    return;
  }

  new window.QRCode(containerEl, {
    text: url,
    width: 180,
    height: 180,
  });
}