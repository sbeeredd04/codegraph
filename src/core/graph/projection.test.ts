import { describe, it, expect } from "vitest";
import { projectGraph } from "./projection.js";
import type { GraphNode, GraphEdge } from "./types.js";

const node = (address: string, kind: GraphNode["kind"]): GraphNode => ({
  address,
  kind,
  name: address,
  location: { file: "a.ts", line: 0, character: 0 },
});

const nodes: GraphNode[] = [
  node("ts:a.ts", "module"),
  node("ts:b.ts", "module"),
  node("ts:a.ts#A", "class"),
  node("ts:a.ts#A.m", "method"),
  node("ts:a.ts#f", "function"),
];
const edges: GraphEdge[] = [
  { from: "ts:a.ts", to: "ts:a.ts#A", type: "contains" },
  { from: "ts:a.ts#A", to: "ts:a.ts#A.m", type: "contains" },
  { from: "ts:a.ts", to: "ts:a.ts#f", type: "contains" },
  { from: "ts:a.ts", to: "ts:b.ts", type: "depends-on" },
  { from: "ts:a.ts#f", to: "ts:a.ts#A.m", type: "calls" },
];

describe("projectGraph", () => {
  it("full keeps everything", () => {
    const p = projectGraph(nodes, edges, "full");
    expect(p.nodes).toHaveLength(5);
    expect(p.edges).toHaveLength(5);
  });

  it("dependency keeps only modules and depends-on edges", () => {
    const p = projectGraph(nodes, edges, "dependency");
    expect(p.nodes.map((n) => n.address).sort()).toEqual(["ts:a.ts", "ts:b.ts"]);
    expect(p.edges).toEqual([{ from: "ts:a.ts", to: "ts:b.ts", type: "depends-on" }]);
  });

  it("call keeps only functions/methods and calls edges", () => {
    const p = projectGraph(nodes, edges, "call");
    expect(p.nodes.map((n) => n.kind).sort()).toEqual(["function", "method"]);
    expect(p.edges).toEqual([{ from: "ts:a.ts#f", to: "ts:a.ts#A.m", type: "calls" }]);
  });

  it("structure keeps all nodes but only contains edges", () => {
    const p = projectGraph(nodes, edges, "structure");
    expect(p.nodes).toHaveLength(5);
    expect(p.edges.every((e) => e.type === "contains")).toBe(true);
    expect(p.edges).toHaveLength(3);
  });
});
