import { describe, it, expect } from "vitest";
import { layeredNeighbourhood } from "./layers.js";
import type { GraphEdge } from "./types.js";

// A small undirected shape (BFS is direction-agnostic, like the focus lens):
//   a — b — c — d   (a chain)
//   a — e           (a second first-degree neighbour)
//   a — a           (self-loop, must be ignored)
//   x — y           (a disconnected component, unreachable from a)
const edges: GraphEdge[] = [
  { from: "a", to: "b", type: "calls" },
  { from: "b", to: "c", type: "calls" },
  { from: "c", to: "d", type: "calls" },
  { from: "a", to: "e", type: "calls" },
  { from: "a", to: "a", type: "calls" },
  { from: "x", to: "y", type: "calls" },
];

describe("layeredNeighbourhood", () => {
  it("returns null for a null/empty selection", () => {
    expect(layeredNeighbourhood(null, edges)).toBeNull();
    expect(layeredNeighbourhood(undefined, edges)).toBeNull();
    expect(layeredNeighbourhood("", edges)).toBeNull();
  });

  it("places every reachable node at its shortest hop-distance", () => {
    const r = layeredNeighbourhood("a", edges)!;
    expect(r.center).toBe("a");
    expect(r.depthOf.get("a")).toBe(0);
    expect(r.depthOf.get("b")).toBe(1);
    expect(r.depthOf.get("e")).toBe(1);
    expect(r.depthOf.get("c")).toBe(2);
    expect(r.depthOf.get("d")).toBe(3);
    // The disconnected component is never reached.
    expect(r.depthOf.has("x")).toBe(false);
    expect(r.depthOf.has("y")).toBe(false);
  });

  it("groups nodes into concentric layers, centre alone at depth 0", () => {
    const r = layeredNeighbourhood("a", edges)!;
    expect(r.layers.length).toBe(4);
    expect(r.layers[0]).toEqual(["a"]);
    expect(new Set(r.layers[1])).toEqual(new Set(["b", "e"]));
    expect(r.layers[2]).toEqual(["c"]);
    expect(r.layers[3]).toEqual(["d"]);
    expect(r.maxReached).toBe(3);
  });

  it("ignores the self-loop (the centre is never its own neighbour)", () => {
    const r = layeredNeighbourhood("a", edges)!;
    expect(r.layers[1]).not.toContain("a");
  });

  it("caps exploration at maxDepth — a 2nd-degree node stays dark at depth 1", () => {
    const r = layeredNeighbourhood("a", edges, 1)!;
    expect(r.maxReached).toBe(1);
    expect(r.layers.length).toBe(2);
    expect(new Set(r.layers[1])).toEqual(new Set(["b", "e"]));
    // c is two hops out — withheld until the depth reaches it.
    expect(r.depthOf.has("c")).toBe(false);
    expect(r.depthOf.has("d")).toBe(false);
  });

  it("maxDepth 0 yields just the centre; a negative cap is treated as 0", () => {
    const zero = layeredNeighbourhood("a", edges, 0)!;
    expect(zero.layers).toEqual([["a"]]);
    expect(zero.depthOf.size).toBe(1);

    const negative = layeredNeighbourhood("a", edges, -3)!;
    expect(negative.layers).toEqual([["a"]]);
    expect(negative.maxReached).toBe(0);
  });

  it("handles an isolated node — a single centre layer", () => {
    const r = layeredNeighbourhood("z", edges)!;
    expect(r.layers).toEqual([["z"]]);
    expect(r.depthOf.get("z")).toBe(0);
    expect(r.maxReached).toBe(0);
  });

  it("takes the shortest path when a node is reachable two ways", () => {
    // a — c directly (depth 1) AND a — b — c (depth 2): the shallower wins.
    const diamond: GraphEdge[] = [
      { from: "a", to: "b", type: "calls" },
      { from: "b", to: "c", type: "calls" },
      { from: "a", to: "c", type: "calls" },
    ];
    const r = layeredNeighbourhood("a", diamond)!;
    expect(r.depthOf.get("c")).toBe(1);
    expect(new Set(r.layers[1])).toEqual(new Set(["b", "c"]));
    expect(r.maxReached).toBe(1);
  });
});
