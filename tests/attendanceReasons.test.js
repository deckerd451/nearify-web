import { describe, expect, it } from "vitest";
import { buildKnownAttendeeReason, scoreRelationshipStrength } from "../assets/js/attendanceReasons.js";

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
});
