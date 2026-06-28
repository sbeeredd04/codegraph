import { describe, it, expect } from "vitest";
import { neighborsOf, focusHighlight } from "./focus.js";
import { pathEdgeKey } from "./path.js";
import type { GraphEdge } from "./types.js";

// A tiny directed graph:  a -> b,  a -> c,  d -> a,  b -> c   (plus a self-loop on a)
const edges: GraphEdge[] = [
  { from: "a", to: "b", type: "calls" },
  { from: "a", to: "c", type: "calls" },
  { from: "d", to: "a", type: "calls" },
  { from: "b", to: "c", type: "calls" },
  { from: "a", to: "a", type: "calls" },
];

describe("neighborsOf", () => {
  it("collects neighbours in both directions, de-duplicated and self-excluded", () => {
    // a's neighbours: b, c (outbound) and d (inbound); the self-loop is ignored.
    expect(neighborsOf("a", edges)).toEqual(new Set(["b", "c", "d"]));
  });

  it("treats a callee the same as a caller (undirected lens)", () => {
    // c is reached from a and b; b is reached from a and reaches c.
    expect(neighborsOf("c", edges)).toEqual(new Set(["a", "b"]));
    expect(neighborsOf("b", edges)).toEqual(new Set(["a", "c"]));
  });

  it("returns an empty set for a node with no edges", () => {
    expect(neighborsOf("zzz", edges)).toEqual(new Set());
  });
});

describe("focusHighlight", () => {
  it("returns null for a null/empty selection", () => {
    expect(focusHighlight(null, edges)).toBeNull();
    expect(focusHighlight(undefined, edges)).toBeNull();
    expect(focusHighlight("", edges)).toBeNull();
  });

  it("includes the centre plus its first-degree neighbours", () => {
    const hl = focusHighlight("a", edges);
    expect(hl?.center).toBe("a");
    expect(hl?.nodes).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("keys every incident edge with pathEdgeKey (both directions)", () => {
    const hl = focusHighlight("a", edges);
    expect(hl?.edges.has(pathEdgeKey("a", "b"))).toBe(true); // outbound
    expect(hl?.edges.has(pathEdgeKey("a", "c"))).toBe(true); // outbound
    expect(hl?.edges.has(pathEdgeKey("d", "a"))).toBe(true); // inbound
    expect(hl?.edges.has(pathEdgeKey("a", "a"))).toBe(true); // self-loop is incident
    expect(hl?.edges.has(pathEdgeKey("b", "c"))).toBe(false); // not incident to a
  });

  it("yields an isolated node as its own sole focus node with no edges", () => {
    const hl = focusHighlight("iso", [{ from: "x", to: "y", type: "calls" }]);
    expect(hl?.nodes).toEqual(new Set(["iso"]));
    expect(hl?.edges.size).toBe(0);
  });
});
