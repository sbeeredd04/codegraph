import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import { findNodes, describeNode, blastRadius, dependencies, graphStats } from "./query.js";
import type { GraphNode, GraphEdge } from "./types.js";

const node = (address: string, kind: GraphNode["kind"], name?: string): GraphNode => ({
  address,
  kind,
  name: name ?? (address.includes("#") ? (address.split(/[#.]/).pop() as string) : address),
  location: { file: address.replace(/^ts:/, "").split("#")[0], line: 3, character: 0 },
});
const edge = (from: string, to: string, type: GraphEdge["type"]): GraphEdge => ({ from, to, type });

const g = new CodeGraph();
[
  node("ts:m.ts", "module", "m.ts"),
  node("ts:m.ts#foo", "function"),
  node("ts:m.ts#bar", "function"),
  node("ts:m.ts#util", "function"),
].forEach((n) => g.addNode(n));
[
  edge("ts:m.ts", "ts:m.ts#foo", "contains"),
  edge("ts:m.ts", "ts:m.ts#bar", "contains"),
  edge("ts:m.ts", "ts:m.ts#util", "contains"),
  edge("ts:m.ts#foo", "ts:m.ts#util", "calls"),
  edge("ts:m.ts#bar", "ts:m.ts#util", "calls"),
].forEach((e) => g.addEdge(e));

describe("graph query layer", () => {
  it("findNodes matches name/address case-insensitively", () => {
    expect(findNodes(g, "UTIL").map((n) => n.address)).toEqual(["ts:m.ts#util"]);
  });

  it("findNodes filters by kind and respects the limit", () => {
    expect(findNodes(g, "", { kind: "function" }).map((n) => n.address).sort()).toEqual([
      "ts:m.ts#bar",
      "ts:m.ts#foo",
      "ts:m.ts#util",
    ]);
    expect(findNodes(g, "", { limit: 2 })).toHaveLength(2);
  });

  it("describeNode groups outbound edges by relation and lists direct dependents", () => {
    const foo = describeNode(g, "ts:m.ts#foo");
    expect(foo?.node.kind).toBe("function");
    expect(foo?.outbound).toContainEqual({ relation: "calls", targets: ["ts:m.ts#util"] });
    expect(foo?.dependents).toEqual([]); // nobody calls foo; the containing module is not a dependent

    const util = describeNode(g, "ts:m.ts#util");
    expect([...(util?.dependents ?? [])].sort()).toEqual(["ts:m.ts#bar", "ts:m.ts#foo"]);
  });

  it("describeNode returns undefined for an unknown address", () => {
    expect(describeNode(g, "ts:nope.ts#ghost")).toBeUndefined();
  });

  it("blastRadius counts transitive dependents via dependency edges", () => {
    const b = blastRadius(g, "ts:m.ts#util");
    expect(b.count).toBe(2);
    expect([...b.impacted].sort()).toEqual(["ts:m.ts#bar", "ts:m.ts#foo"]);
  });

  it("dependencies returns transitive forward closure", () => {
    expect(dependencies(g, "ts:m.ts#foo").dependsOn).toEqual(["ts:m.ts#util"]);
  });

  it("graphStats reports counts by kind", () => {
    const s = graphStats(g);
    expect(s.nodeCount).toBe(4);
    expect(s.edgeCount).toBe(5);
    expect(s.byKind.function).toBe(3);
    expect(s.byKind.module).toBe(1);
  });
});
