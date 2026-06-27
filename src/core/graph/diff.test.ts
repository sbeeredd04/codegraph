import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import { diffGraphs } from "./diff.js";
import type { GraphNode, GraphEdge } from "./types.js";

const node = (address: string, kind: GraphNode["kind"], name?: string): GraphNode => ({
  address,
  kind,
  name: name ?? (address.includes("#") ? (address.split(/[#.]/).pop() as string) : address),
  location: { file: address.replace(/^ts:/, "").split("#")[0], line: 0, character: 0 },
});
const edge = (from: string, to: string, type: GraphEdge["type"]): GraphEdge => ({ from, to, type });
const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): CodeGraph => {
  const g = new CodeGraph();
  nodes.forEach((n) => g.addNode(n));
  edges.forEach((e) => g.addEdge(e));
  return g;
};

describe("diffGraphs", () => {
  it("detects a rename as movedRenamed (not delete+create)", () => {
    const before = graphOf(
      [node("ts:a.ts", "module", "a.ts"), node("ts:a.ts#foo", "function"), node("ts:a.ts#bar", "function")],
      [edge("ts:a.ts", "ts:a.ts#foo", "contains"), edge("ts:a.ts", "ts:a.ts#bar", "contains"), edge("ts:a.ts#foo", "ts:a.ts#bar", "calls")],
    );
    const after = graphOf(
      [node("ts:a.ts", "module", "a.ts"), node("ts:a.ts#baz", "function"), node("ts:a.ts#bar", "function")],
      [edge("ts:a.ts", "ts:a.ts#baz", "contains"), edge("ts:a.ts", "ts:a.ts#bar", "contains"), edge("ts:a.ts#baz", "ts:a.ts#bar", "calls")],
    );
    const d = diffGraphs(before, after);
    expect(d.movedRenamed).toContainEqual({ address: "ts:a.ts#baz", from: "ts:a.ts#foo", to: "ts:a.ts#baz" });
    expect(d.removed).not.toContain("ts:a.ts#foo");
    expect(d.added.find((n) => n.address === "ts:a.ts#baz")).toBeUndefined();
  });

  it("detects a move to another file as movedRenamed", () => {
    const before = graphOf(
      [node("ts:a.ts", "module", "a.ts"), node("ts:a.ts#foo", "function"), node("ts:c.ts", "module", "c.ts"), node("ts:c.ts#helper", "function")],
      [edge("ts:a.ts", "ts:a.ts#foo", "contains"), edge("ts:c.ts", "ts:c.ts#helper", "contains"), edge("ts:a.ts#foo", "ts:c.ts#helper", "calls")],
    );
    const after = graphOf(
      [node("ts:b.ts", "module", "b.ts"), node("ts:b.ts#foo", "function"), node("ts:c.ts", "module", "c.ts"), node("ts:c.ts#helper", "function")],
      [edge("ts:b.ts", "ts:b.ts#foo", "contains"), edge("ts:c.ts", "ts:c.ts#helper", "contains"), edge("ts:b.ts#foo", "ts:c.ts#helper", "calls")],
    );
    const d = diffGraphs(before, after);
    expect(d.movedRenamed).toContainEqual({ address: "ts:b.ts#foo", from: "ts:a.ts#foo", to: "ts:b.ts#foo" });
  });

  it("reports unrelated nodes as added and removed", () => {
    const before = graphOf([node("ts:m1.ts", "module", "m1.ts"), node("ts:m1.ts#gone", "function")], [edge("ts:m1.ts", "ts:m1.ts#gone", "contains")]);
    const after = graphOf([node("ts:m2.ts", "module", "m2.ts"), node("ts:m2.ts#fresh", "function")], [edge("ts:m2.ts", "ts:m2.ts#fresh", "contains")]);
    const d = diffGraphs(before, after);
    expect(d.removed).toContain("ts:m1.ts#gone");
    expect(d.added.map((n) => n.address)).toContain("ts:m2.ts#fresh");
    expect(d.movedRenamed).toEqual([]);
  });

  it("flags a structural (edge) change as changed", () => {
    const nodes = [node("ts:m.ts", "module", "m.ts"), node("ts:m.ts#a", "function"), node("ts:m.ts#b", "function"), node("ts:m.ts#c", "function")];
    const contains = [edge("ts:m.ts", "ts:m.ts#a", "contains"), edge("ts:m.ts", "ts:m.ts#b", "contains"), edge("ts:m.ts", "ts:m.ts#c", "contains")];
    const before = graphOf(nodes, [...contains, edge("ts:m.ts#a", "ts:m.ts#b", "calls")]);
    const after = graphOf(nodes, [...contains, edge("ts:m.ts#a", "ts:m.ts#b", "calls"), edge("ts:m.ts#a", "ts:m.ts#c", "calls")]);
    const d = diffGraphs(before, after);
    expect(d.changed.map((c) => c.address)).toContain("ts:m.ts#a");
  });

  it("falls back to delete+create for a low-confidence leaf rename", () => {
    const before = graphOf([node("ts:m.ts", "module", "m.ts"), node("ts:m.ts#leaf", "method")], [edge("ts:m.ts", "ts:m.ts#leaf", "contains")]);
    const after = graphOf([node("ts:m.ts", "module", "m.ts"), node("ts:m.ts#renamed", "method")], [edge("ts:m.ts", "ts:m.ts#renamed", "contains")]);
    const d = diffGraphs(before, after);
    expect(d.removed).toContain("ts:m.ts#leaf");
    expect(d.added.map((n) => n.address)).toContain("ts:m.ts#renamed");
    expect(d.movedRenamed).toEqual([]);
  });

  it("identical graphs produce an empty delta", () => {
    const g = () => graphOf([node("ts:a.ts", "module", "a.ts"), node("ts:a.ts#x", "function")], [edge("ts:a.ts", "ts:a.ts#x", "contains")]);
    const d = diffGraphs(g(), g());
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.movedRenamed).toEqual([]);
  });
});
