import { describe, expect, it } from "vitest";
import {
  buildRelationshipNarrative,
  formatRelationshipDateSpan,
} from "../assets/js/profileNarrative.js";

describe("buildRelationshipNarrative", () => {
  it("omits absurd spans while preserving the rest of the relationship copy", () => {
    const sentences = buildRelationshipNarrative({
      encounter_count: 12,
      first_encounter_event_name: "Venkats salsa party",
      first_encounter_at: "0025-01-01T00:00:00.000Z",
      last_encounter_at: "2026-06-01T00:00:00.000Z",
      shared_intent: "meet_people",
    });

    expect(sentences.join(" ")).toBe(
      "You've crossed paths 12 times. You originally met at Venkats salsa party. You were both interested in meeting people."
    );
  });

  it("omits the span when either encounter date is missing or invalid", () => {
    expect(buildRelationshipNarrative({
      encounter_count: 3,
      first_encounter_event_name: "Demo Night",
      first_encounter_at: "2026-01-01T00:00:00.000Z",
      last_encounter_at: null,
    }).join(" ")).toBe("You've crossed paths 3 times. You originally met at Demo Night.");

    expect(buildRelationshipNarrative({
      encounter_count: 3,
      first_encounter_event_name: "Demo Night",
      first_encounter_at: "not-a-date",
      last_encounter_at: "2026-01-02T00:00:00.000Z",
    }).join(" ")).toBe("You've crossed paths 3 times. You originally met at Demo Night.");
  });

  it("omits negative and very short spans", () => {
    expect(formatRelationshipDateSpan("2026-02-01", "2026-01-01")).toBeNull();
    expect(formatRelationshipDateSpan("2026-01-01", "2026-01-01")).toBeNull();
    expect(formatRelationshipDateSpan("2026-01-01", "2026-01-15")).toBeNull();
  });

  it("formats reasonable spans from first encounter to most recent encounter", () => {
    expect(formatRelationshipDateSpan("2026-01-01", "2026-03-15")).toBe("over the last 2 months");
    expect(formatRelationshipDateSpan("2024-01-01", "2026-03-15")).toBe("over the last 2 years");
  });
});
