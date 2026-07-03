import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import {
  findNodes,
  findFiles,
  findSymbols,
  listPackages,
  entryPoints,
  describeNode,
  blastRadius,
  dependencies,
  graphStats,
  neighborhood,
} from "./query.js";
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

  it("neighborhood collects nodes within N hops in both directions, with their edges", () => {
    const n1 = neighborhood(g, "ts:m.ts#foo", 1);
    const addrs = n1?.nodes.map((x) => x.address).sort();
    // 1 hop from foo (undirected): the module that contains it + the util it calls
    expect(addrs).toEqual(["ts:m.ts", "ts:m.ts#foo", "ts:m.ts#util"]);
    expect(n1?.edges).toContainEqual({ from: "ts:m.ts#foo", to: "ts:m.ts#util", type: "calls" });
    expect(addrs).not.toContain("ts:m.ts#bar"); // 2 hops away (foo -> m.ts -> bar)
  });

  it("neighborhood widens with radius", () => {
    const n2 = neighborhood(g, "ts:m.ts#foo", 2);
    expect(n2?.nodes.map((x) => x.address)).toContain("ts:m.ts#bar");
  });

  it("neighborhood with radius 0 is just the center", () => {
    const n0 = neighborhood(g, "ts:m.ts#foo", 0);
    expect(n0?.nodes.map((x) => x.address)).toEqual(["ts:m.ts#foo"]);
    expect(n0?.edges).toEqual([]);
  });

  it("neighborhood returns undefined for an unknown address", () => {
    expect(neighborhood(g, "ts:nope#ghost")).toBeUndefined();
  });
});

// FR-77 — the ranked, superset-of-grep lookup surface for the agent.
const g2 = new CodeGraph();
[
  node("ts:packages/web/src/app.ts", "module", "app.ts"),
  node("ts:packages/web/src/app.ts#render", "function", "render"),
  node("ts:packages/web/src/app.ts#App", "class", "App"),
  node("ts:packages/api/src/main.ts", "module", "main.ts"),
  node("ts:packages/api/src/route.ts", "module", "route.ts"),
  node("ts:packages/api/src/route.ts#handler", "function", "handler"),
].forEach((n) => g2.addNode(n));
[
  edge("ts:packages/web/src/app.ts", "ts:packages/web/src/app.ts#render", "contains"),
  edge("ts:packages/web/src/app.ts", "ts:packages/web/src/app.ts#App", "contains"),
  edge("ts:packages/api/src/main.ts", "ts:packages/api/src/route.ts", "depends-on"),
  edge("ts:packages/api/src/main.ts", "ts:packages/web/src/app.ts", "depends-on"),
  edge("ts:packages/api/src/main.ts", "ts:packages/api/src/route.ts#handler", "depends-on"),
  edge("ts:packages/api/src/route.ts#handler", "ts:packages/web/src/app.ts#render", "calls"),
].forEach((e) => g2.addEdge(e));

describe("ranked lookup (FR-77)", () => {
  it("findNodes ranks an exact name match above a prefix match", () => {
    // Both "App" (class) and "app.ts" (module) match "app"; the exact name wins.
    expect(findNodes(g2, "app")[0].name).toBe("App");
  });

  it("findFiles matches on the PATH and returns modules only", () => {
    const r = findFiles(g2, "route");
    expect(r[0].address).toBe("ts:packages/api/src/route.ts");
    expect(r.every((n) => n.kind === "module")).toBe(true);
    // client/index-style nested path fragments still resolve.
    expect(findFiles(g2, "web/src/app").map((n) => n.address)).toContain("ts:packages/web/src/app.ts");
  });

  it("findSymbols returns symbol matches WITH their edges (location + wiring)", () => {
    const r = findSymbols(g2, "render");
    expect(r[0].node.name).toBe("render");
    expect(r[0].node.file).toBe("packages/web/src/app.ts");
    // handler calls render → render's dependents include handler (the grep-beating bit).
    expect(r[0].dependents).toContain("ts:packages/api/src/route.ts#handler");
  });

  it("findSymbols excludes whole-file module nodes", () => {
    const r = findSymbols(g2, "app");
    expect(r.some((d) => d.node.name === "App")).toBe(true); // the class
    expect(r.every((d) => d.node.kind !== "module")).toBe(true); // never app.ts itself
  });

  it("listPackages returns the partition (id, label, count)", () => {
    expect(listPackages(g2).map((p) => p.id)).toEqual(["packages/api", "packages/web"]);
  });

  it("entryPoints finds and ranks a main.ts dependency root with a reason", () => {
    const eps = entryPoints(g2);
    expect(eps[0].name).toBe("main.ts");
    expect(eps[0].file).toBe("packages/api/src/main.ts");
    expect(eps[0].reason).toContain("main.ts");
    expect(eps[0].score).toBeGreaterThan(40);
  });
});
