/**
 * connectionState.js — Pure, DOM-free helpers for rendering caller-relative
 * connection states from get_my_connections({ p_status: "all" }).
 *
 * Shared by the event attendee-discovery cards (eventDetail.js) and the
 * My Connections list (connections.js) so both surfaces stay consistent.
 *
 * The backend RPC (get_my_connections) returns a caller-relative
 * `relationship_label` per row:
 *   - "confirmed"         → both people saved each other
 *   - "proposed_by_me"    → the current user saved them (one-sided, durable)
 *   - "proposed_by_them"  → they saved the current user (awaiting save-back)
 *   - "ghost_claimed"     → saved via a guest interaction the user later claimed
 *   - "proposed"          → a bare row with no proposer (snooze-only); ambiguous,
 *                           must NOT be presented as "Saved"
 *
 * User-facing vocabulary is deliberately limited to "Save", "Saved",
 * "Save back", "Saved you", and "Connected". Internal terms
 * (proposed / relationship / ghost / status) are never surfaced.
 */

/**
 * Card / row state keys — internal, not shown to users.
 * @readonly
 */
export const CONNECTION_STATE = {
  SAVE: "save",           // no durable record yet → offer "Save"
  SAVED: "saved",         // durable one-sided (or claimed) save by this user
  SAVE_BACK: "save_back", // the other person saved this user → offer "Save back"
  CONNECTED: "connected", // mutual
};

/**
 * Map a caller-relative relationship_label to a card/row state.
 *
 * Ambiguous bare "proposed" (no proposer) is intentionally treated as SAVE:
 * we must never claim something is "Saved" when the current user did not save it.
 *
 * @param {string|null|undefined} label relationship_label from get_my_connections
 * @returns {string} one of CONNECTION_STATE
 */
export function stateFromLabel(label) {
  switch (label) {
    case "confirmed":
      return CONNECTION_STATE.CONNECTED;
    case "proposed_by_me":
    case "ghost_claimed":
      return CONNECTION_STATE.SAVED;
    case "proposed_by_them":
      return CONNECTION_STATE.SAVE_BACK;
    // "proposed" (bare / no proposer) and anything unknown are NOT durable
    // saves by this user, so fall through to the neutral, actionable state.
    default:
      return CONNECTION_STATE.SAVE;
  }
}

/**
 * Map the JSON status returned by confirm_relationship() to a card/row state
 * after a successful Save / Save back click.
 *
 * @param {{status?: string}|null|undefined} result
 * @returns {string} CONNECTION_STATE.CONNECTED or CONNECTION_STATE.SAVED
 */
export function stateFromConfirmResult(result) {
  return result?.status === "confirmed"
    ? CONNECTION_STATE.CONNECTED
    : CONNECTION_STATE.SAVED;
}

/**
 * Build a Map(profile_id → CONNECTION_STATE) from a get_my_connections list.
 * Used by attendee cards to render durable state on load / reload.
 *
 * @param {Array<{profile_id?: string, relationship_label?: string}>} connections
 * @returns {Map<string, string>}
 */
export function buildConnectionStateMap(connections) {
  const map = new Map();
  if (!Array.isArray(connections)) return map;
  for (const conn of connections) {
    if (!conn?.profile_id) continue;
    map.set(conn.profile_id, stateFromLabel(conn.relationship_label));
  }
  return map;
}

/**
 * Derive the confirmed-only subset of a get_my_connections({ p_status: "all" })
 * result. This preserves the existing "People You Know Here" and EventReason
 * behavior, which must only ever consider confirmed connections.
 *
 * @param {Array<{relationship_label?: string, status?: string}>} connections
 * @returns {Array} confirmed connections only
 */
export function confirmedOnly(connections) {
  if (!Array.isArray(connections)) return [];
  return connections.filter(
    (c) => c?.relationship_label === "confirmed" || c?.status === "confirmed"
  );
}

/**
 * Execute a durable save (or save-back) via the canonical confirm_relationship
 * write path, with a caller-provided in-flight guard.
 *
 * Pure of the DOM: callers pass the supabase client and the identifiers, plus
 * an `isInFlight`/`setInFlight` pair so double submission can be prevented and
 * unit-tested without a browser.
 *
 * @param {object}   args
 * @param {object}   args.supabase        supabase client (must expose .rpc)
 * @param {string}   args.otherProfileId  the person being saved
 * @param {string}   args.eventId         non-null source event id
 * @param {() => boolean} args.isInFlight  returns true if a save is already running
 * @param {(v: boolean) => void} args.setInFlight  marks in-flight on/off
 * @returns {Promise<{ ok: boolean, state?: string, blocked?: boolean, error?: any }>}
 */
export async function performSave({
  supabase,
  otherProfileId,
  eventId,
  isInFlight,
  setInFlight,
}) {
  if (typeof isInFlight === "function" && isInFlight()) {
    return { ok: false, blocked: true };
  }
  if (typeof setInFlight === "function") setInFlight(true);

  const { data: result, error } = await supabase.rpc("confirm_relationship", {
    p_other_profile_id: otherProfileId,
    p_source_event_id:  eventId,
    p_source_intel_id:  null,
  });

  if (error) {
    if (typeof setInFlight === "function") setInFlight(false);
    return { ok: false, error };
  }

  // Success is terminal: leave the in-flight guard engaged so the control
  // cannot be re-submitted after it has been replaced by a status label.
  return { ok: true, state: stateFromConfirmResult(result) };
}
