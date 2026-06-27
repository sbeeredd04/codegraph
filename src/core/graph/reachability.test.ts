import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import {
  reverseAdjacency,
  forwardAdjacency,
  transitiveClosure,
  DEPENDENCY_EDGES,
} from "./reachability.js";
import type { GraphNode, GraphEdge } from "./types.js";

const node = (address: string): GraphNode => ({
  address,
  kind: "function",
  name: address,
  location: { file: address, line: 0, character: 0 },
});
const edge = (from: string, to: string): GraphEdge => ({ from, to, type: "calls" });
const graphOf = (edges: GraphEdge[]): CodeGraph => {
  const g = new CodeGraph();
  const names = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const n of names) g.addNode(node(n));
  for (const e of edges) g.addEdge(e);
  return g;
};

describe("reachability", () => {
  it("forwardAdjacency follows edges from -> to", () => {
    const g = graphOf([edge("a", "b"), edge("b", "c")]);
    expect(forwardAdjacency(g).get("a")).toEqual(["b"]);
  });

  it("reverseAdjacency follows edges to -> from", () => {
    const g = graphOf([edge("a", "b"), edge("b", "c")]);
    expect(reverseAdjacency(g).get("c")).toEqual(["b"]);
  });

  it("transitiveClosure collects all reachable nodes, excluding the start", () => {
    const g = graphOf([edge("a", "b"), edge("b", "c")]);
    expect(transitiveClosure("a", forwardAdjacency(g)).sort()).toEqual(["b", "c"]);
    expect(transitiveClosure("c", reverseAdjacency(g)).sort()).toEqual(["a", "b"]);
  });

  it("terminates on cycles", () => {
    const g = graphOf([edge("a", "b"), edge("b", "a")]);
    expect(transitiveClosure("a", forwardAdjacency(g)).sort()).toEqual(["b"]);
  });

  it("returns empty for a node with no reachable neighbors", () => {
    const g = graphOf([edge("a", "b")]);
    expect(transitiveClosure("b", forwardAdjacency(g))).toEqual([]);
  });

  it("DEPENDENCY_EDGES excludes structural contains edges", () => {
    const g = new CodeGraph();
    for (const n of ["m", "foo"]) g.addNode(node(n));
    g.addEdge({ from: "m", to: "foo", type: "contains" });
    // foo's only inbound edge is the module containing it — not a dependent.
    expect(reverseAdjacency(g, DEPENDENCY_EDGES).get("foo")).toBeUndefined();
    expect(reverseAdjacency(g).get("foo")).toEqual(["m"]); // unfiltered still sees it
  });
});
