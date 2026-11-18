/**
 * cardEditor.js — /card/: write your own "Building" and "Looking for" lines.
 *
 * Reads and updates only the signed-in person's own profile row, through the
 * existing "users can update their own profile" policy.
 */
import { supabase, getSessionCached } from "./supabaseClient.js";
import { logger } from "./logger.js";
import { CARD_FIELD_MAX, cleanCardText, renderCardFacts } from "./profileCard.js?v=20261118-card1";

const $ = (id) => document.getElementById(id);
const form = $("pcForm");
const building = $("pcBuilding");
const lookingFor = $("pcLookingFor");
const status = $("pcStatus");
const saveBtn = $("pcSave");

let profileId = null;
let saved = { building: null, looking_for: null };

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function current() {
  return { building: cleanCardText(building.value), looking_for: cleanCardText(lookingFor.value) };
}

function updatePreview() {
  const values = current();
  renderCardFacts($("pcPreviewFacts"), values);
  $("pcPreviewEmpty").hidden = Boolean(values.building || values.looking_for);
  for (const [input, count] of [[building, $("pcBuildingCount")], [lookingFor, $("pcLookingForCount")]]) {
    const left = CARD_FIELD_MAX - input.value.length;
    count.textContent = left <= 20 ? `${left} characters left` : "";
  }
  const dirty = values.building !== saved.building || values.looking_for !== saved.looking_for;
  saveBtn.disabled = !dirty;
  if (dirty && status.textContent === "Saved.") status.textContent = "";
}

function showIdentity(profile) {
  $("pcName").textContent = profile?.name || "You";
  const avatar = $("pcAvatar");
  if (profile?.avatar_url && /^https:\/\//.test(profile.avatar_url)) {
    const img = document.createElement("img");
    img.src = profile.avatar_url;
    img.alt = "";
    avatar.replaceChildren(img);
  } else {
    avatar.textContent = initials(profile?.name);
  }
}

async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/card/" },
  });
  if (error) logger.error("[Card] sign-in failed:", error);
}

async function load() {
  const { data } = await getSessionCached();
  const userId = data?.session?.user?.id;
  if (!userId) {
    $("pcSignedOut").hidden = false;
    $("pcSignIn").addEventListener("click", signIn);
    return;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, name, avatar_url, building, looking_for")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !profile) {
    // Most likely the columns don't exist yet (migration not run).
    logger.warn("[Card] profile card unavailable", error?.code);
    $("pcUnavailable").hidden = false;
    return;
  }

  profileId = profile.id;
  saved = { building: cleanCardText(profile.building), looking_for: cleanCardText(profile.looking_for) };
  building.value = saved.building || "";
  lookingFor.value = saved.looking_for || "";
  showIdentity(profile);
  form.hidden = false;
  updatePreview();
}

form.addEventListener("input", updatePreview);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profileId) return;
  const values = current();
  saveBtn.disabled = true;
  status.classList.remove("is-error");
  status.textContent = "Saving…";
  const { error } = await supabase.from("profiles").update(values).eq("id", profileId);
  if (error) {
    logger.warn("[Card] save failed", error.code);
    status.classList.add("is-error");
    status.textContent = "Couldn’t save. Check your connection and try again.";
    saveBtn.disabled = false;
    return;
  }
  saved = values;
  building.value = values.building || "";
  lookingFor.value = values.looking_for || "";
  updatePreview();
  status.textContent = "Saved.";
});

load().catch((err) => {
  logger.error("[Card] load failed", err);
  $("pcUnavailable").hidden = false;
});
