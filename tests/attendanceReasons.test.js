import { describe, expect, it } from "vitest";
import { buildEventDecisionReasons, buildKnownAttendeeReason, buildMissedConnectionReason, computeEventDecisionScore, computeLiveUrgencyBoost, scoreRelationshipStrength } from "../assets/js/attendanceReasons.js";

const now = new Date("2026-06-15T00:00:00Z");

describe("attendance relationship reasons", () => {
  it("keeps single known attendee copy", () => {
    expect(buildKnownAttendeeReason([{ name: "Doug Hamilton", profile_id: "doug" }], { now }))
      .toBe("Doug Hamilton is attending.");
  });

  it("lets one strong relationship dominate weaker count copy", () => {
    const reason = buildKnownAttendeeReason([
      { name: "Alex Morgan", profile_id: "alex", encounter_count: 1, last_encounter_at: "2025-01-01T00:00:00Z", status: "confirmed" },
      { name: "Doug Hamilton", profile_id: "doug", encounter_count: 12, last_encounter_at: "2026-06-01T00:00:00Z", status: "confirmed" },
      { name: "Mia Chen", profile_id: "mia", encounter_count: 1, last_encounter_at: "2025-01-01T00:00:00Z", status: "confirmed" },
    ], { now });

    expect(reason).toBe("Reconnect with Doug Hamilton.");
  });

  it("keeps people-count copy when strong attendees are similar", () => {
    const reason = buildKnownAttendeeReason([
      { name: "Doug Hamilton", profile_id: "doug", encounter_count: 12, last_encounter_at: "2026-06-01T00:00:00Z", status: "confirmed" },
      { name: "Sarah Lee", profile_id: "sarah", encounter_count: 11, last_encounter_at: "2026-06-02T00:00:00Z", status: "confirmed" },
    ], { now });

    expect(reason).toBe("2 people you know are attending.");
  });


  it("builds a missed connection reason for known attendees not seen recently", () => {
    const reason = buildMissedConnectionReason([
      { name: "Doug Hamilton", profile_id: "doug", encounter_count: 3, last_encounter_at: "2026-02-15T00:00:00Z", status: "confirmed" },
    ], { now });

    expect(reason).toMatchObject({
      type: "person",
      title: "Reconnect with Doug Hamilton",
      description: "You have not crossed paths in 4 months.",
      reasonKind: "missed_connection",
      personId: "doug",
      encounterCount: 3,
    });
  });

  it("does not build missed connection reasons for recent or unknown encounters", () => {
    expect(buildMissedConnectionReason([
      { name: "Doug Hamilton", profile_id: "doug", encounter_count: 3, last_encounter_at: "2026-05-15T00:00:00Z" },
    ], { now })).toBeNull();

    expect(buildMissedConnectionReason([
      { name: "Mia Chen", profile_id: "mia", encounter_count: 0, last_encounter_at: "2026-01-15T00:00:00Z" },
    ], { now })).toBeNull();
  });


  it("surfaces missed connection as the attendance reason for a single stale known attendee", () => {
    const reasons = buildEventDecisionReasons({
      now,
      connections: [
        { name: "Doug Hamilton", profile_id: "doug", encounter_count: 3, last_encounter_at: "2026-02-15T00:00:00Z", status: "confirmed" },
      ],
      eventAttendees: [],
    });

    expect(reasons.map((reason) => reason.title)).toEqual(["Reconnect with Doug Hamilton"]);
    expect(reasons[0].description).toBe("You have not crossed paths in 4 months.");
  });

  it("ranks missed connection reasons without displacing stronger relationship reasons", () => {
    const reasons = buildEventDecisionReasons({
      now,
      currentProfileId: "me",
      connections: [
        { name: "Doug Hamilton", profile_id: "doug", encounter_count: 3, last_encounter_at: "2026-02-15T00:00:00Z", status: "confirmed" },
        { name: "Sarah Lee", profile_id: "sarah", encounter_count: 12, last_encounter_at: "2026-06-01T00:00:00Z", status: "confirmed" },
      ],
      eventAttendees: [],
    });

    expect(reasons.map((reason) => reason.title)).toEqual([
      "Reconnect with Sarah Lee",
      "Reconnect with Doug Hamilton",
    ]);
    expect(reasons[1].description).toBe("You have not crossed paths in 4 months.");
  });

  it("adds shared current-event intent when attendee rows are already available", () => {
    const strength = scoreRelationshipStrength({
      profile_id: "doug",
      encounter_count: 4,
      last_encounter_at: "2026-06-01T00:00:00Z",
      status: "confirmed",
    }, {
      now,
      currentProfileId: "me",
      eventAttendees: [
        { profile_id: "me", intent_primary: "hire", intent_secondary: ["meet_people"] },
        { profile_id: "doug", intent_primary: "meet_people", intent_secondary: [] },
      ],
    });

    expect(strength.score).toBe(75);
    expect(strength.level).toBe("strong");
  });

  it("builds top event decision reasons without exposing scores", () => {
    const reasons = buildEventDecisionReasons({
      now,
      currentProfileId: "me",
      connections: [
        { name: "Doug Hamilton", profile_id: "doug", encounter_count: 12, last_encounter_at: "2026-06-01T00:00:00Z", status: "confirmed" },
      ],
      eventAttendees: [
        { profile_id: "me", intent_primary: "find_cofounder" },
        { profile_id: "doug", intent_primary: "find_cofounder" },
        { profile_id: "sarah", intent_primary: "find_cofounder" },
        { profile_id: "alex", intent_primary: "find_cofounder" },
      ],
    });

    expect(reasons.map((reason) => reason.title)).toEqual([
      "Doug Hamilton is attending",
      "Strong founder + builder overlap",
      "4 people attending",
    ]);
    expect(reasons.every((reason) => reason.title.includes("100") === false)).toBe(true);
  });
  it("computes event decision score from top reasons and urgency", () => {
    const score = computeEventDecisionScore([
      { title: "Reconnect", rank: 180 },
      { title: "Shared goal", rank: 36 },
      { title: "Momentum", rank: 14 },
    ], { starts_at: "2026-06-15T12:00:00Z" }, { now, liveUrgencyBoost: 70 });

    expect(score).toBeCloseTo((180 * 0.65) + (((180 + 36 + 14) / 3) * 0.25) + (70 * 0.10));
  });

  it("gives live events the strongest urgency boost", () => {
    expect(computeLiveUrgencyBoost({
      starts_at: "2026-06-14T23:00:00Z",
      ends_at: "2026-06-15T01:00:00Z",
      is_active: true,
    }, now)).toBe(100);

    expect(computeLiveUrgencyBoost({ starts_at: "2026-06-17T00:00:00Z" }, now)).toBe(40);
  });

});
