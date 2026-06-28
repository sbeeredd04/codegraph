import { describe, it, expect } from "vitest";
import {
  planReplay,
  clampDwell,
  REPLAY_DWELL_DEFAULT_MS,
  REPLAY_DWELL_MIN_MS,
  REPLAY_DWELL_MAX_MS,
} from "./replay.js";

describe("clampDwell (FR-40 replay sequencer)", () => {
  it("defaults a missing or non-finite dwell", () => {
    expect(clampDwell()).toBe(REPLAY_DWELL_DEFAULT_MS);
    expect(clampDwell(undefined)).toBe(REPLAY_DWELL_DEFAULT_MS);
    expect(clampDwell(Number.NaN)).toBe(REPLAY_DWELL_DEFAULT_MS);
    expect(clampDwell(Number.POSITIVE_INFINITY)).toBe(REPLAY_DWELL_DEFAULT_MS);
  });

  it("clamps to the sane band and rounds", () => {
    expect(clampDwell(0)).toBe(REPLAY_DWELL_MIN_MS);
    expect(clampDwell(50)).toBe(REPLAY_DWELL_MIN_MS);
    expect(clampDwell(99_999)).toBe(REPLAY_DWELL_MAX_MS);
    expect(clampDwell(640.6)).toBe(641);
    expect(clampDwell(-100)).toBe(REPLAY_DWELL_MIN_MS);
  });
});

describe("planReplay (FR-40 guided tour)", () => {
  const seq = ["a", "b", "c"];

  it("steps through the stops in order, lighting them cumulatively", () => {
    const { steps } = planReplay(seq, { dwellMs: 500 });
    expect(steps.map((s) => s.focus)).toEqual(["a", "b", "c"]);
    expect(steps.map((s) => s.highlight)).toEqual([["a"], ["a", "b"], ["a", "b", "c"]]);
  });

  it("spaces step start times by the resolved dwell and reports the duration", () => {
    const plan = planReplay(seq, { dwellMs: 500 });
    expect(plan.dwellMs).toBe(500);
    expect(plan.steps.map((s) => s.startMs)).toEqual([0, 500, 1000]);
    expect(plan.durationMs).toBe(1500);
    expect(plan.reducedMotion).toBe(false);
  });

  it("marks only the final stop isLast", () => {
    const { steps } = planReplay(seq, { dwellMs: 300 });
    expect(steps.map((s) => s.isLast)).toEqual([false, false, true]);
  });

  it("applies the clamped dwell, not the raw value", () => {
    const plan = planReplay(["a", "b"], { dwellMs: 5 });
    expect(plan.dwellMs).toBe(REPLAY_DWELL_MIN_MS);
    expect(plan.steps[1].startMs).toBe(REPLAY_DWELL_MIN_MS);
  });

  it("collapses to a single instant step under reduced motion (the whole trail, framed last)", () => {
    const plan = planReplay(seq, { dwellMs: 500, reducedMotion: true });
    expect(plan.reducedMotion).toBe(true);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      index: 0,
      focus: "c",
      highlight: ["a", "b", "c"],
      startMs: 0,
      isLast: true,
    });
    expect(plan.durationMs).toBe(0);
  });

  it("drops empty addresses before planning", () => {
    const { steps } = planReplay(["a", "", "b"], { dwellMs: 400 });
    expect(steps.map((s) => s.focus)).toEqual(["a", "b"]);
    expect(steps.map((s) => s.startMs)).toEqual([0, 400]);
  });

  it("yields an empty plan for an all-empty set (the controller no-ops)", () => {
    const plan = planReplay(["", ""], { dwellMs: 400 });
    expect(plan.steps).toEqual([]);
    expect(plan.durationMs).toBe(0);
  });

  it("preserves a repeated stop (a tour may legitimately revisit a node)", () => {
    const { steps } = planReplay(["a", "b", "a"], { dwellMs: 300 });
    expect(steps.map((s) => s.focus)).toEqual(["a", "b", "a"]);
    expect(steps[2].highlight).toEqual(["a", "b", "a"]);
  });
});
