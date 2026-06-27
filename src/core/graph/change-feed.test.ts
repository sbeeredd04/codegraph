import { describe, it, expect } from "vitest";
import { CodeGraph } from "./graph.js";
import { rankedChangeFeed } from "./change-feed.js";
import type { GraphNode, GraphEdge, GraphDelta } from "./types.js";

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
const emptyDelta = (): GraphDelta => ({ added: [], removed: [], changed: [], movedRenamed: [] });

describe("rankedChangeFeed", () => {
  it("ranks changes by blast radius — the most depended-upon change first", () => {
    const util = node("ts:m.ts#util", "function");
    const lonely = node("ts:m.ts#lonely", "function");
    const nodes = [
      node("ts:m.ts", "module", "m.ts"),
      util,
      lonely,
      node("ts:m.ts#c1", "function"),
      node("ts:m.ts#c2", "function"),
      node("ts:m.ts#c3", "function"),
    ];
    const after = graphOf(nodes, [
      edge("ts:m.ts#c1", "ts:m.ts#util", "calls"),
      edge("ts:m.ts#c2", "ts:m.ts#util", "calls"),
      edge("ts:m.ts#c3", "ts:m.ts#util", "calls"),
    ]);
    const delta: GraphDelta = {
      ...emptyDelta(),
      changed: [
        { address: "ts:m.ts#lonely", before: lonely, after: lonely },
        { address: "ts:m.ts#util", before: util, after: util },
      ],
    };
    const feed = rankedChangeFeed(delta, after, after);
    expect(feed.map((c) => c.address)).toEqual(["ts:m.ts#util", "ts:m.ts#lonely"]);
    expect(feed[0].blastRadius).toBe(3);
    expect(feed[1].blastRadius).toBe(0);
  });

  it("counts transitive dependents, not just direct callers", () => {
    const c = node("ts:m.ts#c", "function");
    const after = graphOf(
      [node("ts:m.ts#a", "function"), node("ts:m.ts#b", "function"), c],
      [edge("ts:m.ts#a", "ts:m.ts#b", "calls"), edge("ts:m.ts#b", "ts:m.ts#c", "calls")],
    );
    const delta: GraphDelta = { ...emptyDelta(), changed: [{ address: "ts:m.ts#c", before: c, after: c }] };
    const feed = rankedChangeFeed(delta, after, after);
    expect(feed[0].blastRadius).toBe(2); // b calls c, a calls b
  });

  it("computes a removed node's blast radius against the before graph", () => {
    const x = node("ts:m.ts#x", "function");
    const before = graphOf(
      [x, node("ts:m.ts#y", "function"), node("ts:m.ts#z", "function")],
      [edge("ts:m.ts#y", "ts:m.ts#x", "calls"), edge("ts:m.ts#z", "ts:m.ts#x", "calls")],
    );
    const after = graphOf([node("ts:m.ts#y", "function"), node("ts:m.ts#z", "function")], []);
    const delta: GraphDelta = { ...emptyDelta(), removed: ["ts:m.ts#x"] };
    const feed = rankedChangeFeed(delta, before, after);
    expect(feed[0].change).toBe("removed");
    expect(feed[0].blastRadius).toBe(2);
  });

  it("returns an empty feed for an empty delta", () => {
    const g = graphOf([node("ts:m.ts", "module", "m.ts")], []);
    expect(rankedChangeFeed(emptyDelta(), g, g)).toEqual([]);
  });
});
