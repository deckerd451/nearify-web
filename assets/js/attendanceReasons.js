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

const INTENT_REASON_LABELS = {
  meet_people: "networking",
  find_cofounder: "founder + builder",
  hire: "hiring",
  explore_ideas: "idea exploration",
  demo_something: "demo + builder",
};

function stripTerminalPunctuation(value = "") {
  return String(value).trim().replace(/[.!?]+$/g, "");
}

function pluralizePeople(count) {
  return count === 1 ? "person" : "people";
}

function buildIntentOverlapReason(attendees = [], currentProfileId = null) {
  if (!currentProfileId || !attendees?.length) return null;

  const myRow = attendees.find((row) => row?.profile_id === currentProfileId || row?.profileId === currentProfileId);
  const myIntent = myRow?.intent_primary || myRow?.intent;
  if (!myIntent) return null;

  const overlapCount = attendees.filter((row) => {
    const profileId = row?.profile_id || row?.profileId;
    const intent = row?.intent_primary || row?.intent;
    return profileId !== currentProfileId && intent === myIntent;
  }).length;

  if (overlapCount < 2) return null;

  const label = INTENT_REASON_LABELS[myIntent] || String(myIntent).replace(/_/g, " ");
  return {
    type: "opportunity",
    title: `Strong ${label} overlap`,
    rank: 30 + overlapCount,
    opportunityKind: "shared_goal",
  };
}

function buildMomentumReason(attendees = []) {
  const count = attendees?.length || 0;
  if (count < 3) return null;
  return {
    type: "opportunity",
    title: `${count} ${pluralizePeople(count)} attending`,
    rank: 10 + Math.min(count, 20),
    opportunityKind: "meet_people",
    count,
  };
}

export function computeLiveUrgencyBoost(event = {}, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return 0;

  const startMs = parseDateMs(event.starts_at);
  const endMs = parseDateMs(event.ends_at);

  if (event.is_active !== false && startMs && startMs <= nowMs && (!endMs || nowMs <= endMs)) {
    return 100;
  }

  if (!startMs || startMs < nowMs) return 0;

  const hoursUntilStart = (startMs - nowMs) / 3_600_000;
  if (hoursUntilStart <= 24) return 70;
  if (hoursUntilStart <= 72) return 40;
  if (hoursUntilStart <= 168) return 20;
  return 0;
}

export function computeEventDecisionScore(reasons = [], event = {}, options = {}) {
  const scores = (reasons || [])
    .map((reason) => Number(reason?.score ?? reason?.rank) || 0)
    .filter((score) => score > 0)
    .sort((a, b) => b - a);

  const maxReasonScore = scores[0] || 0;
  const topThree = scores.slice(0, 3);
  const avgTopThreeReasonScore = topThree.length
    ? topThree.reduce((sum, score) => sum + score, 0) / topThree.length
    : 0;
  const liveUrgencyBoost = Number(options.liveUrgencyBoost) || computeLiveUrgencyBoost(event, options.now || new Date());

  return (maxReasonScore * 0.65)
    + (avgTopThreeReasonScore * 0.25)
    + (liveUrgencyBoost * 0.10);
}

export function buildEventDecisionReasons({ connections = [], eventAttendees = [], currentProfileId = null } = {}) {
  const reasons = [];
  const knownReason = buildKnownAttendeeReason(connections, { eventAttendees, currentProfileId });

  if (knownReason) {
    const ranked = rankKnownAttendees(connections, { eventAttendees, currentProfileId });
    const top = ranked[0];
    reasons.push({
      type: knownReason.startsWith("Reconnect with ") ? "person" : "people",
      title: stripTerminalPunctuation(knownReason),
      rank: 100 + (top?.relationshipStrength?.score || 0),
      personId: top?.profile_id,
      personName: top?.name,
      count: ranked.length,
    });
  }

  const intentReason = buildIntentOverlapReason(eventAttendees, currentProfileId);
  if (intentReason) reasons.push(intentReason);

  const momentumReason = buildMomentumReason(eventAttendees);
  if (momentumReason) reasons.push(momentumReason);

  const seen = new Set();
  return reasons
    .filter((reason) => {
      const key = reason.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3);
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
