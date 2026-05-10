/**
 * peopleRelationship.js
 *
 * Relationship-state adapter for the Nearify People tab.
 *
 * Derives a single relationship state per person by merging signals from:
 *   - Claimed ghost interactions  (one-sided event memories)
 *   - Direct profile interactions (proximity, QR confirmed)
 *   - Optional savedContact overlay (Apple Contacts — supplied by caller)
 *
 * State hierarchy, weakest → strongest:
 *   encountered  — one-sided event memory from a claimed guest interaction
 *   repeated     — multiple encounters or seen at ≥2 events
 *   connected    — explicit Nearify connection (qr_confirmed / proximity)
 *   savedContact — saved to Apple Contacts through Nearify (client overlay)
 *
 * ONE PERSON = ONE CARD.
 * The same profile is never surfaced in more than one state bucket.
 * When a person qualifies for multiple states, the strongest wins.
 *
 * Usage:
 *   import { loadPeopleRelationships, groupPeopleByState } from "./peopleRelationship.js";
 *
 *   // Basic — server signals only
 *   const people = await loadPeopleRelationships();
 *
 *   // With Apple Contacts overlay (iOS passes known saved profile IDs)
 *   const saved = new Set(["uuid-a", "uuid-b"]);
 *   const people = await loadPeopleRelationships(saved);
 *
 *   const { savedContacts, connected, encountered } = groupPeopleByState(people);
 */

import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// Types (JSDoc only — no TypeScript runtime overhead)
// ---------------------------------------------------------------------------

/**
 * @typedef {'encountered'|'repeated'|'connected'|'savedContact'} RelationshipState
 */

/**
 * @typedef {Object} RelationshipPerson
 * @property {string}            profileId
 * @property {string}            name
 * @property {string|null}       avatarUrl
 * @property {RelationshipState} state
 * @property {number}            encounterCount
 * @property {number}            eventCount
 * @property {string|null}       lastEventId
 * @property {string|null}       lastEventName
 * @property {string}            contextLabel   - Human-readable label for the card
 * @property {string}            lastSeenAt     - ISO timestamp
 */

// ---------------------------------------------------------------------------
// State ranking — higher = stronger
// ---------------------------------------------------------------------------

const STATE_RANK = /** @type {Record<RelationshipState, number>} */ ({
  encountered:  1,
  repeated:     2,
  connected:    3,
  savedContact: 4,
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch merged, deduplicated relationship states for all people the current
 * authenticated user has any interaction signal with.
 *
 * Claimed ghost interactions appear as `encountered` unless a stronger signal
 * (repeated, connected, savedContact) is also present for the same profile.
 *
 * @param {Set<string>} [savedContactIds]
 *   Profile IDs the caller knows are saved to Apple Contacts.
 *   Any matching profile is promoted to `savedContact` regardless of server state.
 * @returns {Promise<RelationshipPerson[]>}
 *   Sorted strongest-first, then most-recently-seen.
 */
export async function loadPeopleRelationships(savedContactIds = new Set()) {
  const { data, error } = await supabase.rpc("get_people_relationship_states");

  if (error) {
    console.error(
      "[PeopleRelationship] RPC failed",
      error.message,
      error.code,
    );
    return [];
  }

  const rows = data ?? [];

  const encounteredCount = rows.filter(
    (r) => r.relationship_state === "encountered",
  ).length;
  console.log(
    "[PeopleRelationship] Loaded claimed guest interactions:",
    encounteredCount,
  );

  // Map + apply savedContact overlay
  const people = rows.map((row) => {
    let state = /** @type {RelationshipState} */ (row.relationship_state);

    if (savedContactIds.has(row.profile_id) && STATE_RANK[state] < STATE_RANK.savedContact) {
      console.log("[PeopleRelationship] Promoted", row.profile_id, "to savedContact");
      state = "savedContact";
    }

    return {
      profileId:     row.profile_id,
      name:          row.name,
      avatarUrl:     row.avatar_url    ?? null,
      state,
      encounterCount: row.encounter_count,
      eventCount:     row.event_count,
      lastEventId:   row.last_event_id   ?? null,
      lastEventName: row.last_event_name ?? null,
      contextLabel:  state === "savedContact" ? "Saved to Contacts" : row.context_label,
      lastSeenAt:    row.last_seen_at,
    };
  });

  // Deduplicate by profileId — the RPC already deduplicates, but the
  // savedContact overlay can shift ranks so we re-run here to be safe.
  const byId = new Map();
  for (const person of people) {
    const existing = byId.get(person.profileId);
    if (!existing) {
      byId.set(person.profileId, person);
    } else if (STATE_RANK[person.state] > STATE_RANK[existing.state]) {
      console.log(
        "[PeopleRelationship] Promoted",
        person.profileId,
        "to",
        person.state,
      );
      byId.set(person.profileId, person);
    }
  }

  const merged = [...byId.values()].sort(
    (a, b) =>
      STATE_RANK[b.state] - STATE_RANK[a.state] ||
      new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  );

  console.log("[PeopleRelationship] Merged people count:", merged.length);

  return merged;
}

/**
 * Partition a flat people list into display sections for the People tab.
 *
 * A person appears in exactly one section — the strongest applicable bucket.
 * `savedContacts` profiles are never duplicated in `connected` or `encountered`.
 *
 * @param {RelationshipPerson[]} people - Output of loadPeopleRelationships()
 * @returns {{
 *   savedContacts: RelationshipPerson[],
 *   connected:     RelationshipPerson[],
 *   encountered:   RelationshipPerson[],
 * }}
 */
export function groupPeopleByState(people) {
  const savedContacts = people.filter((p) => p.state === "savedContact");
  const connected     = people.filter((p) => p.state === "connected");
  const encountered   = people.filter(
    (p) => p.state === "encountered" || p.state === "repeated",
  );

  return { savedContacts, connected, encountered };
}

/**
 * Returns the display label for a relationship state — suitable for card
 * secondary text when the `contextLabel` from the server is not specific enough.
 *
 * For `encountered` cards: use `person.contextLabel` ("Met at {Event}") instead.
 *
 * @param {RelationshipState} state
 * @returns {string}
 */
export function stateDisplayLabel(state) {
  switch (state) {
    case "savedContact": return "Saved to Contacts";
    case "connected":    return "Connected";
    case "repeated":     return "Met multiple times";
    case "encountered":  return "Met at an event";
    default:             return "";
  }
}

/**
 * Whether a card in the given state should show the strong green
 * connection/link icon. Encountered-only cards should suppress it.
 *
 * @param {RelationshipState} state
 * @returns {boolean}
 */
export function shouldShowConnectionIcon(state) {
  return state === "connected" || state === "savedContact";
}
