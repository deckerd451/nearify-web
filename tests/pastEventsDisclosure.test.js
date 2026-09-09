import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Past Events progressive-disclosure regression tests.
//
// The events page renders inline (no importable module), so we assert the
// markup/CSS contract and model the disclosure render decision (count,
// collapsed-by-default reveal, empty state) with a small pure mirror of the
// inline logic in events/index.html.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "..");
const EVENTS_HTML = fs.readFileSync(path.join(REPO, "events/index.html"), "utf8");
const STYLES_CSS = fs.readFileSync(path.join(REPO, "assets/css/styles.css"), "utf8");

// Pure mirror of the past-events branch in loadEvents(): given past events and
// DOM-like state objects, apply the same visibility/count/open decisions.
function applyPastDisclosure(past, { section, count, empty, grid }) {
  if (past.length) {
    grid.html = past.map((ev) => `card:${ev.id}`).join("");
    count.text = "(" + past.length + ")";
    section.open = false;
    section.hidden = false;
    empty.hidden = true;
  } else {
    section.hidden = true;
    empty.hidden = false;
  }
}

function makeState() {
  return {
    section: { open: true, hidden: false }, // start non-collapsed to prove we set it
    count: { text: "" },
    empty: { hidden: true },
    grid: { html: "" },
  };
}

describe("Past events markup — native accessible details/summary", () => {
  it("uses a <details> with matching </details> for the past section", () => {
    expect(EVENTS_HTML).toMatch(/<details[^>]*id="pastEventsSection"[^>]*class="past-events-disclosure"/);
    expect(EVENTS_HTML).toMatch(/<\/details>/);
  });

  it("is collapsed by default (no `open` attribute on the details)", () => {
    const detailsTag = EVENTS_HTML.match(/<details[^>]*id="pastEventsSection"[^>]*>/)[0];
    expect(detailsTag).not.toMatch(/\bopen\b/);
  });

  it("is hidden by default until data loads (no flash / no empty section)", () => {
    const detailsTag = EVENTS_HTML.match(/<details[^>]*id="pastEventsSection"[^>]*>/)[0];
    expect(detailsTag).toMatch(/\bhidden\b/);
  });

  it("has a <summary> with a 'Past events' label and a count element", () => {
    const details = EVENTS_HTML.match(/<details[^>]*id="pastEventsSection"[\s\S]*?<\/details>/)[0];
    expect(details).toMatch(/<summary[^>]*class="past-events-summary"/);
    expect(details).toMatch(/Past events/);
    expect(details).toMatch(/id="pastEventsCount"/);
  });

  it("keeps the existing explanation and past-events grid inside the disclosure", () => {
    const details = EVENTS_HTML.match(/<details[^>]*id="pastEventsSection"[\s\S]*?<\/details>/)[0];
    expect(details).toMatch(/saved connections and follow-up notes/);
    expect(details).toMatch(/id="pastEventsGrid"/);
  });

  it("provides a minimal non-interactive empty state element", () => {
    expect(EVENTS_HTML).toMatch(/id="pastEventsEmpty"[^>]*hidden[^>]*>No past events/);
  });

  it("decorative chevron is aria-hidden (not announced)", () => {
    expect(EVENTS_HTML).toMatch(/class="past-events-chevron" aria-hidden="true"/);
  });
});

describe("Past events accessibility / touch-target CSS", () => {
  it("summary has a >=44px touch target", () => {
    expect(STYLES_CSS).toMatch(/\.past-events-summary\s*\{[\s\S]*?min-height:\s*44px/);
  });
  it("summary exposes a visible keyboard focus indicator", () => {
    expect(STYLES_CSS).toMatch(/\.past-events-summary:focus-visible\s*\{[\s\S]*?outline:/);
  });
});

describe("Past events disclosure behavior (mirror of loadEvents past branch)", () => {
  it("collapsed by default when past events exist", () => {
    const s = makeState();
    applyPastDisclosure([{ id: "p1" }, { id: "p2" }], s);
    expect(s.section.open).toBe(false);
    expect(s.section.hidden).toBe(false);
  });

  it("shows the correct count", () => {
    const s = makeState();
    applyPastDisclosure([{ id: "p1" }, { id: "p2" }, { id: "p3" }], s);
    expect(s.count.text).toBe("(3)");
  });

  it("renders the existing past cards into the grid (content unchanged)", () => {
    const s = makeState();
    applyPastDisclosure([{ id: "p1" }, { id: "p2" }], s);
    expect(s.grid.html).toBe("card:p1card:p2");
  });

  it("empty state: hides disclosure and shows 'No past events'", () => {
    const s = makeState();
    applyPastDisclosure([], s);
    expect(s.section.hidden).toBe(true);
    expect(s.empty.hidden).toBe(false);
    expect(s.grid.html).toBe(""); // no card render for empty
  });

  it("non-empty hides the empty-state element", () => {
    const s = makeState();
    applyPastDisclosure([{ id: "p1" }], s);
    expect(s.empty.hidden).toBe(true);
  });
});

describe("Upcoming events remain the priority (unchanged)", () => {
  it("upcoming section still exists above the past disclosure", () => {
    const upcomingIdx = EVENTS_HTML.indexOf('id="upcoming-events"');
    const pastIdx = EVENTS_HTML.indexOf('id="pastEventsSection"');
    expect(upcomingIdx).toBeGreaterThan(-1);
    expect(pastIdx).toBeGreaterThan(upcomingIdx); // past comes after upcoming
  });
});
