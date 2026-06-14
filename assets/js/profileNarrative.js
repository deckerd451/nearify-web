const INTENT_LABELS = {
  meet_people:    "meeting people",
  find_cofounder: "finding collaborators",
  hire:           "hiring",
  explore_ideas:  "exploring ideas",
  demo:           "demoing",
};

function parseEncounterDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatRelationshipDateSpan(firstValue, lastValue) {
  const first = parseEncounterDate(firstValue);
  const last  = parseEncounterDate(lastValue);
  if (!first || !last) return null;

  const diffMs = last.getTime() - first.getTime();
  if (diffMs < 0) return null;

  const diffDays = Math.floor(diffMs / 86400000);
  const maxReasonableDays = 50 * 365;
  if (diffDays > maxReasonableDays) return null;

  if (diffDays > 365) {
    const years = Math.floor(diffDays / 365);
    return years === 1 ? "over the last year" : `over the last ${years} years`;
  }

  if (diffDays > 30) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? "over the last month" : `over the last ${months} months`;
  }

  return null;
}

export function buildRelationshipNarrative(ctx) {
  const count      = ctx.encounter_count ?? 0;
  const intent     = ctx.shared_intent;
  const firstName  = ctx.first_encounter_event_name;
  const firstAt    = parseEncounterDate(ctx.first_encounter_at);
  const span       = formatRelationshipDateSpan(ctx.first_encounter_at, ctx.last_encounter_at);
  const sentences  = [];

  if (count === 1 && firstName) {
    sentences.push(`You originally met at ${firstName}.`);
  } else if (count === 1 && firstAt) {
    sentences.push(`You've crossed paths once.`);
  } else if (count > 1) {
    const spanPhrase = span ? ` ${span}` : "";
    sentences.push(`You've crossed paths ${count} times${spanPhrase}.`);

    if (firstName) {
      sentences.push(`You originally met at ${firstName}.`);
    }
  }

  if (intent && INTENT_LABELS[intent]) {
    sentences.push(`You were both interested in ${INTENT_LABELS[intent]}.`);
  }

  return sentences;
}

export { INTENT_LABELS, formatRelationshipDateSpan, parseEncounterDate };
