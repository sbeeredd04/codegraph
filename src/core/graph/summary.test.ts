import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import { summarizeGraph } from "./summary.js";
import type { GraphNode } from "./types.js";

const node = (address: string, kind: GraphNode["kind"]): GraphNode => ({
  address,
  kind,
  name: address,
  location: { file: "a.ts", line: 0, character: 0 },
});

describe("summarizeGraph", () => {
  it("counts nodes, edges, kinds, and orphans", () => {
    const g = new CodeGraph();
    g.addNode(node("ts:a.ts", "module"));
    g.addNode(node("ts:a.ts#A", "class"));
    g.addNode(node("ts:a.ts#A.m", "method"));
    g.addNode(node("ts:a.ts#dead", "function"));
    g.addEdge({ from: "ts:a.ts", to: "ts:a.ts#A", type: "contains" });
    g.addEdge({ from: "ts:a.ts#A", to: "ts:a.ts#A.m", type: "contains" });

    const s = summarizeGraph(g);
    expect(s.nodeCount).toBe(4);
    expect(s.edgeCount).toBe(2);
    expect(s.byKind.module).toBe(1);
    expect(s.byKind.class).toBe(1);
    expect(s.byKind.method).toBe(1);
    expect(s.byKind.function).toBe(1);
    // `ts:a.ts` and `ts:a.ts#dead` have no inbound edge.
    expect(s.orphanCount).toBe(2);
  });

  it("handles an empty graph", () => {
    const s = summarizeGraph(new CodeGraph());
    expect(s.nodeCount).toBe(0);
    expect(s.edgeCount).toBe(0);
    expect(s.orphanCount).toBe(0);
    expect(s.byKind.function).toBe(0);
  });
});
