const DOMINANCE_SCORE_THRESHOLD = 70;
const DOMINANCE_GAP_THRESHOLD = 15;

function parseDateMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeStatus(connection = {}) {
  return connection.status || connection.relationship_label || null;
}

function scoreRecency(lastEncounterAt, now = new Date()) {
  const lastMs = parseDateMs(lastEncounterAt);
  if (!lastMs) return 0;
  const ageDays = Math.max(0, (now.getTime() - lastMs) / 86_400_000);
  if (ageDays <= 30) return 25;
  if (ageDays <= 90) return 18;
  if (ageDays <= 180) return 10;
  return 4;
}

function scoreStatus(connection = {}) {
  const status = normalizeStatus(connection);
  if (status === "confirmed" || connection.confirmed_at) return 20;
  if (status === "ghost_claimed") return 12;
  if (status === "proposed_by_me" || status === "proposed_by_them" || status === "proposed") return 8;
  return 0;
}

function hasSharedIntent(connection = {}, eventAttendees = [], currentProfileId = null) {
  if (connection.shared_intent) return true;
  if (!currentProfileId || !connection.profile_id) return false;

  const myRow = eventAttendees.find((row) => row?.profile_id === currentProfileId);
  const theirRow = eventAttendees.find((row) => row?.profile_id === connection.profile_id);
  if (!myRow || !theirRow) return false;

  const myIntents = new Set([myRow.intent_primary, ...(myRow.intent_secondary || [])].filter(Boolean));
  const theirIntents = [theirRow.intent_primary, ...(theirRow.intent_secondary || [])].filter(Boolean);
  return theirIntents.some((intent) => myIntents.has(intent));
}

export function scoreRelationshipStrength(connection = {}, context = {}) {
  const encounterCount = Number(connection.encounter_count) || 0;
  const encounterScore = Math.min(encounterCount, 9) * 5;
  const recencyScore = scoreRecency(connection.last_encounter_at, context.now || new Date());
  const statusScore = scoreStatus(connection);
  const intentScore = hasSharedIntent(connection, context.eventAttendees, context.currentProfileId) ? 10 : 0;
  const score = Math.min(100, encounterScore + recencyScore + statusScore + intentScore);

  let level = "weak";
  if (score >= 70 || (scoreStatus(connection) >= 20 && encounterCount >= 5 && recencyScore >= 10)) {
    level = "strong";
  } else if (score >= 40 || (scoreStatus(connection) >= 12 && encounterCount >= 2)) {
    level = "medium";
  }

  return { score, level };
}

function statusRank(connection = {}) {
  const status = normalizeStatus(connection);
  if (status === "confirmed" || connection.confirmed_at) return 3;
  if (status === "ghost_claimed") return 2;
  if (status === "proposed_by_me" || status === "proposed_by_them" || status === "proposed") return 1;
  return 0;
}

export function rankKnownAttendees(connections = [], context = {}) {
  return [...connections]
    .map((connection) => ({
      ...connection,
      relationshipStrength: scoreRelationshipStrength(connection, context),
    }))
    .sort((a, b) => {
      // Tie-breakers intentionally mirror the Phase 2 audit and should stay
      // deterministic for future iOS alignment: score, encounter depth,
      // recency, relationship status, then stable display identity.
      const scoreDelta = b.relationshipStrength.score - a.relationshipStrength.score;
      if (scoreDelta !== 0) return scoreDelta;

      const encounterDelta = (Number(b.encounter_count) || 0) - (Number(a.encounter_count) || 0);
      if (encounterDelta !== 0) return encounterDelta;

      const recencyDelta = parseDateMs(b.last_encounter_at) - parseDateMs(a.last_encounter_at);
      if (recencyDelta !== 0) return recencyDelta;

      const relationshipDelta = statusRank(b) - statusRank(a);
      if (relationshipDelta !== 0) return relationshipDelta;

      return String(a.name || a.profile_id || "").localeCompare(String(b.name || b.profile_id || ""));
    });
}

export function buildKnownAttendeeReason(connections = [], context = {}) {
  const ranked = rankKnownAttendees(connections, context);
  if (!ranked.length) return "";

  const [top, second] = ranked;
  const topName = top.name || "Someone you know";
  if (ranked.length === 1) return `${topName} is attending.`;

  const strongCount = ranked.filter((conn) => conn.relationshipStrength.level === "strong").length;
  const topDominates = top.relationshipStrength.score >= DOMINANCE_SCORE_THRESHOLD
    && (!second || top.relationshipStrength.score - second.relationshipStrength.score >= DOMINANCE_GAP_THRESHOLD)
    && strongCount < 2;

  // Dominance threshold: a named reconnection only replaces generic count copy
  // when the strongest attendee is strong (70+) and clears the runner-up by 15+.
  // Keep this derived-only contract aligned with iOS when a shared
  // AttendanceReason object is introduced.
  if (topDominates) return `Reconnect with ${topName}.`;

  return `${ranked.length} people you know are attending.`;
}
