import { describe, it, expect } from "vitest";
import {
  EMPTY_TRACE,
  extendTrace,
  undoTrace,
  clearTrace,
  traceHighlight,
} from "./trace.js";
import type { GraphEdge, NodeAddress } from "./types.js";

// A → B → C → D linear chain, plus an isolated island E with no route in.
const nodes: { address: NodeAddress }[] = [
  { address: "A" },
  { address: "B" },
  { address: "C" },
  { address: "D" },
  { address: "E" },
];
const edges: GraphEdge[] = [
  { from: "A", to: "B", type: "calls" },
  { from: "B", to: "C", type: "calls" },
  { from: "C", to: "D", type: "calls" },
];

describe("extendTrace", () => {
  it("starts the trace at the first clicked node", () => {
    const t = extendTrace(EMPTY_TRACE, nodes, edges, "B");
    expect(t.steps).toEqual(["B"]);
  });

  it("splices in the shortest directed path for a reachable click", () => {
    const t = extendTrace({ steps: ["A"] }, nodes, edges, "C");
    // A→B→C — the intermediate B is made explicit, tail not duplicated.
    expect(t.steps).toEqual(["A", "B", "C"]);
  });

  it("appends a single hop for a directly-adjacent click", () => {
    const t = extendTrace({ steps: ["A"] }, nodes, edges, "B");
    expect(t.steps).toEqual(["A", "B"]);
  });

  it("accumulates across multiple clicks into one ordered route", () => {
    let t = extendTrace(EMPTY_TRACE, nodes, edges, "A");
    t = extendTrace(t, nodes, edges, "B");
    t = extendTrace(t, nodes, edges, "D");
    expect(t.steps).toEqual(["A", "B", "C", "D"]);
  });

  it("is idempotent when re-clicking the current tail (same object back)", () => {
    const start = { steps: ["A", "B"] };
    const t = extendTrace(start, nodes, edges, "B");
    expect(t).toBe(start);
  });

  it("appends a disjoint jump when the target is unreachable", () => {
    // No edge leads into E, so there is no directed route A → E.
    const t = extendTrace({ steps: ["A"] }, nodes, edges, "E");
    expect(t.steps).toEqual(["A", "E"]);
  });

  it("appends a disjoint jump for an unknown address", () => {
    const t = extendTrace({ steps: ["A"] }, nodes, edges, "Z");
    expect(t.steps).toEqual(["A", "Z"]);
  });

  it("allows revisiting a node already on the trace (loops are legitimate)", () => {
    // From D there is no forward route back to B, so the revisit is a jump.
    const t = extendTrace({ steps: ["A", "B", "C", "D"] }, nodes, edges, "B");
    expect(t.steps).toEqual(["A", "B", "C", "D", "B"]);
  });

  it("does not mutate the input state", () => {
    const start = { steps: ["A"] };
    extendTrace(start, nodes, edges, "C");
    expect(start.steps).toEqual(["A"]);
  });
});

describe("undoTrace", () => {
  it("drops the last node", () => {
    expect(undoTrace({ steps: ["A", "B", "C"] }).steps).toEqual(["A", "B"]);
  });

  it("returns the same empty state unchanged", () => {
    expect(undoTrace(EMPTY_TRACE)).toBe(EMPTY_TRACE);
  });
});

describe("clearTrace", () => {
  it("resets to the empty trace", () => {
    expect(clearTrace()).toBe(EMPTY_TRACE);
    expect(clearTrace().steps).toEqual([]);
  });
});

describe("traceHighlight", () => {
  it("lights every step node and the directed edge between each consecutive pair", () => {
    const hl = traceHighlight({ steps: ["A", "B", "C"] });
    expect([...hl.nodes].sort()).toEqual(["A", "B", "C"]);
    expect([...hl.edges].sort()).toEqual(["A B", "B C"]);
  });

  it("produces no edges for a single-node trace", () => {
    const hl = traceHighlight({ steps: ["A"] });
    expect([...hl.nodes]).toEqual(["A"]);
    expect(hl.edges.size).toBe(0);
  });

  it("is empty for the empty trace", () => {
    const hl = traceHighlight(EMPTY_TRACE);
    expect(hl.nodes.size).toBe(0);
    expect(hl.edges.size).toBe(0);
  });
});
