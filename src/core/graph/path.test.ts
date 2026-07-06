import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import type { EdgeType, GraphNode, NodeKind } from "./types.js";
import { findPath, findPathInEdges, pathHighlight, pathEdgeKey } from "./path.js";

function node(address: string, kind: NodeKind = "function"): GraphNode {
  const name = address.split("#")[1] ?? address;
  return { address, kind, name, location: { file: address.split("#")[0], line: 1, character: 0 } };
}

function build(addrs: string[], edges: [string, string, EdgeType][]): CodeGraph {
  const g = new CodeGraph();
  for (const a of addrs) g.addNode(node(a));
  for (const [from, to, type] of edges) g.addEdge({ from, to, type });
  return g;
}

describe("findPath", () => {
  it("finds a direct one-edge path", () => {
    const g = build(["a", "b"], [["a", "b", "calls"]]);
    const r = findPath(g, "a", "b");
    expect(r).toBeDefined();
    expect(r!.found).toBe(true);
    expect(r!.length).toBe(1);
    expect(r!.nodes).toEqual(["a", "b"]);
    expect(r!.steps).toEqual([{ from: "a", to: "b", type: "calls" }]);
  });

  it("finds a transitive path and reports each edge type in order", () => {
    const g = build(
      ["a", "b", "c"],
      [
        ["a", "b", "calls"],
        ["b", "c", "depends-on"],
      ],
    );
    const r = findPath(g, "a", "c");
    expect(r!.found).toBe(true);
    expect(r!.length).toBe(2);
    expect(r!.nodes).toEqual(["a", "b", "c"]);
    expect(r!.steps.map((s) => s.type)).toEqual(["calls", "depends-on"]);
  });

  it("returns the shortest path when multiple routes exist", () => {
    // a -> b -> d  (2 hops)   vs   a -> c -> x -> d  (3 hops)
    const g = build(
      ["a", "b", "c", "x", "d"],
      [
        ["a", "b", "calls"],
        ["b", "d", "calls"],
        ["a", "c", "calls"],
        ["c", "x", "calls"],
        ["x", "d", "calls"],
      ],
    );
    const r = findPath(g, "a", "d");
    expect(r!.found).toBe(true);
    expect(r!.length).toBe(2);
    expect(r!.nodes).toEqual(["a", "b", "d"]);
  });

  it("reports found:false with no steps when unreachable", () => {
    const g = build(["a", "b", "c"], [["a", "b", "calls"]]);
    const r = findPath(g, "a", "c");
    expect(r!.found).toBe(false);
    expect(r!.steps).toEqual([]);
    expect(r!.nodes).toEqual([]);
    expect(r!.length).toBe(0);
  });

  it("treats a node reaching itself as a found zero-length path", () => {
    const g = build(["a", "b"], [["a", "b", "calls"]]);
    const r = findPath(g, "a", "a");
    expect(r!.found).toBe(true);
    expect(r!.length).toBe(0);
    expect(r!.nodes).toEqual(["a"]);
    expect(r!.steps).toEqual([]);
  });

  it("returns undefined when either endpoint is unknown", () => {
    const g = build(["a", "b"], [["a", "b", "calls"]]);
    expect(findPath(g, "a", "missing")).toBeUndefined();
    expect(findPath(g, "missing", "b")).toBeUndefined();
  });

  it("excludes structural contains edges by default", () => {
    // a contains b, but containment is not a flow — no dependency route a -> b.
    const g = build(["a", "b"], [["a", "b", "contains"]]);
    const r = findPath(g, "a", "b");
    expect(r!.found).toBe(false);
  });

  it("honors a custom edgeTypes set (e.g. including contains)", () => {
    const g = build(["a", "b"], [["a", "b", "contains"]]);
    const r = findPath(g, "a", "b", { edgeTypes: new Set<EdgeType>(["contains"]) });
    expect(r!.found).toBe(true);
    expect(r!.steps).toEqual([{ from: "a", to: "b", type: "contains" }]);
  });

  it("is cycle-safe (a cycle on the way to the target terminates)", () => {
    const g = build(
      ["a", "b", "c"],
      [
        ["a", "b", "calls"],
        ["b", "a", "calls"], // back-edge: a <-> b cycle
        ["b", "c", "calls"],
      ],
    );
    const r = findPath(g, "a", "c");
    expect(r!.found).toBe(true);
    expect(r!.nodes).toEqual(["a", "b", "c"]);
  });

  it("follows hands-off-to edges (workflow handoffs are flows)", () => {
    const g = build(
      ["w1", "w2"],
      [["w1", "w2", "hands-off-to"]],
    );
    const r = findPath(g, "w1", "w2");
    expect(r!.found).toBe(true);
    expect(r!.steps[0].type).toBe("hands-off-to");
  });
});

describe("findPath — virtual dispatch (FR-97 override edges)", () => {
  // The requests shape: a caller reaches the ABSTRACT base method (the static resolution),
  // two concrete adapters override it. Override edges are stored override→base.
  const build97 = () =>
    build(
      ["caller", "Base.send", "HTTP.send", "Other.send"],
      [
        ["caller", "Base.send", "calls"], // static resolution lands on the base
        ["HTTP.send", "Base.send", "overrides"],
        ["Other.send", "Base.send", "overrides"],
      ],
    );

  it("resolves a call that lands on a base method to the concrete override", () => {
    const r = findPath(build97(), "caller", "HTTP.send");
    expect(r!.found).toBe(true);
    expect(r!.nodes).toEqual(["caller", "Base.send", "HTTP.send"]);
    // The last hop is the reverse-override dispatch step: base -> override, type "overrides".
    expect(r!.steps.at(-1)).toEqual({ from: "Base.send", to: "HTTP.send", type: "overrides" });
  });

  it("does NOT hop between sibling overrides through the shared base", () => {
    // HTTP.send -> Base.send would need a FORWARD override traversal, which is never added,
    // so there is no HTTP.send -> Base.send -> Other.send path between unrelated siblings.
    const r = findPath(build97(), "HTTP.send", "Other.send");
    expect(r!.found).toBe(false);
  });

  it("traces strictly static edges when resolveOverrides is disabled", () => {
    const r = findPath(build97(), "caller", "HTTP.send", { resolveOverrides: false });
    expect(r!.found).toBe(false); // without dispatch resolution the override is unreachable
  });
});

describe("findPathInEdges (raw-array entry)", () => {
  const nodes: GraphNode[] = ["a", "b", "c"].map((a) => node(a));
  const edges: { from: string; to: string; type: EdgeType }[] = [
    { from: "a", to: "b", type: "calls" },
    { from: "b", to: "c", type: "calls" },
  ];

  it("matches the CodeGraph entry on the same data", () => {
    const r = findPathInEdges(nodes, edges, "a", "c");
    expect(r!.found).toBe(true);
    expect(r!.nodes).toEqual(["a", "b", "c"]);
  });

  it("returns undefined for an unknown endpoint", () => {
    expect(findPathInEdges(nodes, edges, "a", "z")).toBeUndefined();
  });

  it("accepts lightweight {address}-only node rows (the webview's node set)", () => {
    // The panel/viewer hold {address,name,kind} rows, not full GraphNodes; path
    // finding only needs the address, so those rows must type- and run-check.
    const light = [{ address: "a" }, { address: "b" }, { address: "c" }];
    const r = findPathInEdges(light, edges, "a", "c");
    expect(r!.found).toBe(true);
    expect(r!.nodes).toEqual(["a", "b", "c"]);
  });
});

describe("pathHighlight", () => {
  it("derives node + edge highlight sets from a found path", () => {
    const g = build(["a", "b", "c"], [["a", "b", "calls"], ["b", "c", "calls"]]);
    const hl = pathHighlight(findPath(g, "a", "c"));
    expect([...hl.nodes].sort()).toEqual(["a", "b", "c"]);
    expect(hl.edges.has(pathEdgeKey("a", "b"))).toBe(true);
    expect(hl.edges.has(pathEdgeKey("b", "c"))).toBe(true);
    expect(hl.edges.has(pathEdgeKey("a", "c"))).toBe(false); // not a direct hop
  });

  it("is empty for a not-found or undefined path", () => {
    const g = build(["a", "b"], [["a", "b", "calls"]]);
    expect(pathHighlight(findPath(g, "b", "a")).nodes.size).toBe(0);
    expect(pathHighlight(undefined).edges.size).toBe(0);
  });
});
