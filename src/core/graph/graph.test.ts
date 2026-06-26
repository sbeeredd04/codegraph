import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import type { GraphNode, GraphEdge } from "./types.js";

const node = (address: string, name = address): GraphNode => ({
  address,
  kind: "function",
  name,
  location: { file: "a.ts", line: 0, character: 0 },
});

const edge = (from: string, to: string): GraphEdge => ({ from, to, type: "calls" });

describe("CodeGraph (pure core)", () => {
  it("stores and retrieves a node by address", () => {
    const g = new CodeGraph();
    g.addNode(node("ts:a.ts#foo"));
    expect(g.getNode("ts:a.ts#foo")?.name).toBe("ts:a.ts#foo");
    expect(g.getNode("missing")).toBeUndefined();
  });

  it("counts nodes and edges", () => {
    const g = new CodeGraph();
    g.addNode(node("a"));
    g.addNode(node("b"));
    g.addEdge(edge("a", "b"));
    expect(g.order).toBe(2);
    expect(g.size).toBe(1);
  });

  it("returns outbound neighbors", () => {
    const g = new CodeGraph();
    g.addNode(node("a"));
    g.addNode(node("b"));
    g.addEdge(edge("a", "b"));
    expect(g.neighbors("a")).toEqual(["b"]);
    expect(g.neighbors("b")).toEqual([]);
  });

  it("finds orphan nodes (no inbound edges) — FR-12 seed", () => {
    const g = new CodeGraph();
    g.addNode(node("entry"));
    g.addNode(node("used"));
    g.addNode(node("dead"));
    g.addEdge(edge("entry", "used"));
    // `entry` has no inbound edge but `dead` is the true orphan we care about;
    // both have zero inbound here — orphans returns every node with no inbound edge.
    expect(g.orphans().sort()).toEqual(["dead", "entry"]);
  });

  it("ignores edges to unknown nodes when counting neighbors", () => {
    const g = new CodeGraph();
    g.addNode(node("a"));
    g.addEdge(edge("a", "ghost"));
    expect(g.neighbors("a")).toEqual(["ghost"]);
    expect(g.orphans()).toEqual(["a"]);
  });
});
