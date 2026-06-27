import { describe, it, expect } from "vitest";
import { reconcilePositions, type XY } from "./layout.js";

const prev = (entries: Record<string, XY>) => new Map(Object.entries(entries));

describe("reconcilePositions (stable live layout)", () => {
  it("keeps surviving nodes at their exact previous positions", () => {
    const nodes = [
      { id: "a", x: 1, y: 0 },
      { id: "b", x: 0, y: 1 },
    ];
    const positions = reconcilePositions(nodes, [], prev({ a: { x: 12, y: -4 }, b: { x: -7, y: 9 } }));
    expect(positions.get("a")).toEqual({ x: 12, y: -4 });
    expect(positions.get("b")).toEqual({ x: -7, y: 9 });
  });

  it("drops a new node at its placed neighbour's position", () => {
    const nodes = [
      { id: "mod", x: 1, y: 0 },
      { id: "new", x: 0.5, y: 0.5 },
    ];
    const edges = [{ source: "mod", target: "new" }];
    const positions = reconcilePositions(nodes, edges, prev({ mod: { x: 10, y: 20 } }));
    expect(positions.get("mod")).toEqual({ x: 10, y: 20 });
    expect(positions.get("new")).toEqual({ x: 10, y: 20 }); // lands on its anchor
  });

  it("places a new node at the centroid of multiple placed neighbours", () => {
    const nodes = [
      { id: "p", x: 1, y: 0 },
      { id: "q", x: 0, y: 1 },
      { id: "new", x: 9, y: 9 },
    ];
    const edges = [
      { source: "p", target: "new" },
      { source: "q", target: "new" },
    ];
    const positions = reconcilePositions(nodes, edges, prev({ p: { x: 0, y: 0 }, q: { x: 4, y: 8 } }));
    expect(positions.get("new")).toEqual({ x: 2, y: 4 }); // midpoint of (0,0) and (4,8)
  });

  it("falls back to the seed for an isolated new node", () => {
    const nodes = [{ id: "lonely", x: 0.7, y: -0.3 }];
    const positions = reconcilePositions(nodes, [], prev({}));
    expect(positions.get("lonely")).toEqual({ x: 0.7, y: -0.3 });
  });

  it("falls back to the seed when a new node's only neighbour is also new", () => {
    const nodes = [
      { id: "n1", x: 0.1, y: 0.2 },
      { id: "n2", x: 0.3, y: 0.4 },
    ];
    const edges = [{ source: "n1", target: "n2" }];
    const positions = reconcilePositions(nodes, edges, prev({})); // nothing placed yet
    expect(positions.get("n1")).toEqual({ x: 0.1, y: 0.2 });
    expect(positions.get("n2")).toEqual({ x: 0.3, y: 0.4 });
  });
});
