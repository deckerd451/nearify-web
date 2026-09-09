import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_STATE,
  stateFromLabel,
  stateFromConfirmResult,
  buildConnectionStateMap,
  confirmedOnly,
  performSave,
} from "../assets/js/connectionState.js";

describe("stateFromLabel — caller-relative card/row state", () => {
  it("no relationship (undefined/null/unknown) → Save", () => {
    expect(stateFromLabel(undefined)).toBe(CONNECTION_STATE.SAVE);
    expect(stateFromLabel(null)).toBe(CONNECTION_STATE.SAVE);
    expect(stateFromLabel("something_new")).toBe(CONNECTION_STATE.SAVE);
  });

  it("proposed_by_me → Saved", () => {
    expect(stateFromLabel("proposed_by_me")).toBe(CONNECTION_STATE.SAVED);
  });

  it("proposed_by_them → Save back", () => {
    expect(stateFromLabel("proposed_by_them")).toBe(CONNECTION_STATE.SAVE_BACK);
  });

  it("confirmed → Connected", () => {
    expect(stateFromLabel("confirmed")).toBe(CONNECTION_STATE.CONNECTED);
  });

  it("ghost_claimed → Saved", () => {
    expect(stateFromLabel("ghost_claimed")).toBe(CONNECTION_STATE.SAVED);
  });

  it("ambiguous bare 'proposed' (no proposer) is NOT falsely labeled Saved", () => {
    // Must fall through to the neutral, actionable Save state — never Saved.
    expect(stateFromLabel("proposed")).toBe(CONNECTION_STATE.SAVE);
    expect(stateFromLabel("proposed")).not.toBe(CONNECTION_STATE.SAVED);
  });
});

describe("stateFromConfirmResult — post-save transition", () => {
  it("confirmed result → Connected", () => {
    expect(stateFromConfirmResult({ status: "confirmed" })).toBe(CONNECTION_STATE.CONNECTED);
  });

  it("proposed result → Saved", () => {
    expect(stateFromConfirmResult({ status: "proposed" })).toBe(CONNECTION_STATE.SAVED);
  });

  it("missing/empty result defaults to Saved (durable one-sided save)", () => {
    expect(stateFromConfirmResult(null)).toBe(CONNECTION_STATE.SAVED);
    expect(stateFromConfirmResult(undefined)).toBe(CONNECTION_STATE.SAVED);
    expect(stateFromConfirmResult({})).toBe(CONNECTION_STATE.SAVED);
  });
});

describe("buildConnectionStateMap — full caller-relative state for cards", () => {
  const connections = [
    { profile_id: "p-mine",    relationship_label: "proposed_by_me" },
    { profile_id: "p-theirs",  relationship_label: "proposed_by_them" },
    { profile_id: "p-conf",    relationship_label: "confirmed" },
    { profile_id: "p-ghost",   relationship_label: "ghost_claimed" },
    { profile_id: "p-bare",    relationship_label: "proposed" },
    { relationship_label: "confirmed" }, // no profile_id → skipped
  ];

  it("maps every profile to its caller-relative state", () => {
    const map = buildConnectionStateMap(connections);
    expect(map.get("p-mine")).toBe(CONNECTION_STATE.SAVED);
    expect(map.get("p-theirs")).toBe(CONNECTION_STATE.SAVE_BACK);
    expect(map.get("p-conf")).toBe(CONNECTION_STATE.CONNECTED);
    expect(map.get("p-ghost")).toBe(CONNECTION_STATE.SAVED);
    expect(map.get("p-bare")).toBe(CONNECTION_STATE.SAVE);
  });

  it("skips rows without a profile_id and unknown profiles default to Save", () => {
    const map = buildConnectionStateMap(connections);
    expect(map.size).toBe(5);
    expect(map.get("not-present") || CONNECTION_STATE.SAVE).toBe(CONNECTION_STATE.SAVE);
  });

  it("handles non-array input safely", () => {
    expect(buildConnectionStateMap(null).size).toBe(0);
    expect(buildConnectionStateMap(undefined).size).toBe(0);
  });
});

describe("confirmedOnly — preserves existing recommendation / People You Know Here input", () => {
  const mixed = [
    { profile_id: "a", relationship_label: "proposed_by_me", status: "proposed" },
    { profile_id: "b", relationship_label: "proposed_by_them", status: "proposed" },
    { profile_id: "c", relationship_label: "confirmed", status: "confirmed" },
    { profile_id: "d", relationship_label: "ghost_claimed", status: "ghost_claimed" },
    { profile_id: "e", status: "confirmed" }, // label absent, status confirmed
  ];

  it("returns only confirmed connections", () => {
    const result = confirmedOnly(mixed);
    const ids = result.map((c) => c.profile_id).sort();
    expect(ids).toEqual(["c", "e"]);
  });

  it("never includes proposed or ghost states", () => {
    const result = confirmedOnly(mixed);
    for (const c of result) {
      expect(c.relationship_label === "confirmed" || c.status === "confirmed").toBe(true);
    }
    expect(result.some((c) => c.relationship_label === "proposed_by_me")).toBe(false);
    expect(result.some((c) => c.relationship_label === "proposed_by_them")).toBe(false);
    expect(result.some((c) => c.relationship_label === "ghost_claimed")).toBe(false);
  });

  it("handles non-array input safely", () => {
    expect(confirmedOnly(null)).toEqual([]);
    expect(confirmedOnly(undefined)).toEqual([]);
  });
});

describe("performSave — save / save-back write path", () => {
  function makeSupabase(response) {
    return {
      rpc: vi.fn().mockResolvedValue(response),
    };
  }

  it("calls confirm_relationship with the correct arguments", async () => {
    const supabase = makeSupabase({ data: { status: "proposed" }, error: null });
    let inFlight = false;
    await performSave({
      supabase,
      otherProfileId: "other-123",
      eventId: "event-abc",
      isInFlight: () => inFlight,
      setInFlight: (v) => { inFlight = v; },
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("confirm_relationship", {
      p_other_profile_id: "other-123",
      p_source_event_id:  "event-abc",
      p_source_intel_id:  null,
    });
  });

  it("returns Saved on a one-sided (proposed) success", async () => {
    const supabase = makeSupabase({ data: { status: "proposed" }, error: null });
    let inFlight = false;
    const out = await performSave({
      supabase, otherProfileId: "o", eventId: "e",
      isInFlight: () => inFlight, setInFlight: (v) => { inFlight = v; },
    });
    expect(out.ok).toBe(true);
    expect(out.state).toBe(CONNECTION_STATE.SAVED);
  });

  it("returns Connected when the save completes a mutual confirmation", async () => {
    const supabase = makeSupabase({ data: { status: "confirmed" }, error: null });
    let inFlight = false;
    const out = await performSave({
      supabase, otherProfileId: "o", eventId: "e",
      isInFlight: () => inFlight, setInFlight: (v) => { inFlight = v; },
    });
    expect(out.ok).toBe(true);
    expect(out.state).toBe(CONNECTION_STATE.CONNECTED);
  });

  it("reports failure and clears the in-flight guard so the user can retry", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "boom" } });
    let inFlight = false;
    const out = await performSave({
      supabase, otherProfileId: "o", eventId: "e",
      isInFlight: () => inFlight, setInFlight: (v) => { inFlight = v; },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toEqual({ message: "boom" });
    expect(inFlight).toBe(false); // retry allowed after failure
  });

  it("prevents double submission while a save is in flight", async () => {
    const supabase = makeSupabase({ data: { status: "proposed" }, error: null });
    let inFlight = true; // simulate an in-progress save
    const out = await performSave({
      supabase, otherProfileId: "o", eventId: "e",
      isInFlight: () => inFlight, setInFlight: (v) => { inFlight = v; },
    });
    expect(out.blocked).toBe(true);
    expect(out.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("keeps the in-flight guard engaged after success (control is terminal)", async () => {
    const supabase = makeSupabase({ data: { status: "proposed" }, error: null });
    let inFlight = false;
    await performSave({
      supabase, otherProfileId: "o", eventId: "e",
      isInFlight: () => inFlight, setInFlight: (v) => { inFlight = v; },
    });
    // Not reset on success — the button is replaced by a status label, so it
    // must never become clickable again.
    expect(inFlight).toBe(true);
  });
});
