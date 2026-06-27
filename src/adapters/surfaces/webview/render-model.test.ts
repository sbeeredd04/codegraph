import { describe, it, expect } from "vitest";
import { buildRenderModel, findOrphanAddresses, KIND_COLORS } from "./render-model.js";
import type { GraphNode, GraphEdge } from "../../../core/graph/types.js";

const node = (address: string, kind: GraphNode["kind"]): GraphNode => ({
  address,
  kind,
  name: address.split("#").pop() ?? address,
  location: { file: "a.ts", line: 0, character: 0 },
});

describe("buildRenderModel", () => {
  const nodes: GraphNode[] = [
    node("ts:a.ts", "module"),
    node("ts:a.ts#A", "class"),
    node("ts:a.ts#A.m", "method"),
  ];
  const edges: GraphEdge[] = [
    { from: "ts:a.ts", to: "ts:a.ts#A", type: "contains" },
    { from: "ts:a.ts#A", to: "ts:a.ts#A.m", type: "contains" },
    { from: "ts:a.ts#A", to: "ts:ghost", type: "calls" }, // dangling — must be dropped
  ];

  it("maps every node with id, label, kind color, and numeric coordinates", () => {
    const model = buildRenderModel(nodes, edges);
    expect(model.nodes).toHaveLength(3);
    const a = model.nodes.find((n) => n.id === "ts:a.ts#A");
    expect(a?.label).toBe("A");
    expect(a?.color).toBe(KIND_COLORS.class);
    expect(typeof a?.x).toBe("number");
    expect(typeof a?.y).toBe("number");
    expect(a?.file).toBe("a.ts");
    expect(a?.line).toBe(0);
  });

  it("drops edges whose endpoints are not both known nodes (Sigma safety)", () => {
    const model = buildRenderModel(nodes, edges);
    expect(model.edges).toHaveLength(2);
    expect(model.edges.every((e) => e.source !== "ts:ghost" && e.target !== "ts:ghost")).toBe(true);
    expect(model.edges.every((e) => e.type === "contains")).toBe(true);
  });

  it("gives distinct colors per kind", () => {
    expect(KIND_COLORS.module).not.toBe(KIND_COLORS.function);
  });

  it("handles an empty graph", () => {
    const model = buildRenderModel([], []);
    expect(model.nodes).toEqual([]);
    expect(model.edges).toEqual([]);
  });

  it("attaches enrichment to nodes present in the enrichments map", () => {
    const enrichments = new Map([
      ["ts:a.ts#A", { summary: "the A class", intent: "model A", role: "value object" }],
    ]);
    const model = buildRenderModel(nodes, edges, undefined, undefined, undefined, enrichments);
    expect(model.nodes.find((n) => n.id === "ts:a.ts#A")?.enrichment).toEqual({
      summary: "the A class",
      intent: "model A",
      role: "value object",
    });
    // a node without an entry carries no enrichment
    expect(model.nodes.find((n) => n.id === "ts:a.ts")?.enrichment).toBeUndefined();
  });

  it("recolors changed nodes via the change overlay", () => {
    const changes = new Map<string, "added" | "changed" | "moved">([["ts:a.ts#A", "changed"]]);
    const model = buildRenderModel(nodes, edges, changes, { added: 0, removed: 0, changed: 1, moved: 0 });
    const a = model.nodes.find((n) => n.id === "ts:a.ts#A");
    expect(a?.change).toBe("changed");
    expect(a?.color).toBe("#e3b341"); // change-amber, not the kind color
    expect(model.delta?.changed).toBe(1);
    // an unchanged node keeps its kind color
    expect(model.nodes.find((n) => n.id === "ts:a.ts")?.color).toBe(KIND_COLORS.module);
  });

  it("flags only nodes present in the orphans set (FR-12)", () => {
    const orphans = new Set(["ts:a.ts"]); // the module has no inbound edge here
    const model = buildRenderModel(nodes, edges, undefined, undefined, undefined, undefined, orphans);
    expect(model.nodes.find((n) => n.id === "ts:a.ts")?.orphan).toBe(true);
    // nodes with inbound edges carry no orphan flag at all
    expect(model.nodes.find((n) => n.id === "ts:a.ts#A")?.orphan).toBeUndefined();
    expect(model.nodes.find((n) => n.id === "ts:a.ts#A.m")?.orphan).toBeUndefined();
  });
});

describe("findOrphanAddresses", () => {
  it("returns addresses with no inbound edge of any kind", () => {
    const ns: GraphNode[] = [node("ts:a.ts", "module"), node("ts:a.ts#A", "class")];
    const es: GraphEdge[] = [{ from: "ts:a.ts", to: "ts:a.ts#A", type: "contains" }];
    const orphans = findOrphanAddresses(ns, es);
    expect(orphans.has("ts:a.ts")).toBe(true); // never a target
    expect(orphans.has("ts:a.ts#A")).toBe(false); // contained -> has inbound
  });

  it("treats inbound edges of any type (including contains) as a reference", () => {
    const ns: GraphNode[] = [node("ts:a.ts#f", "function"), node("ts:a.ts#g", "function")];
    const es: GraphEdge[] = [{ from: "ts:a.ts#f", to: "ts:a.ts#g", type: "calls" }];
    const orphans = findOrphanAddresses(ns, es);
    expect(orphans.has("ts:a.ts#f")).toBe(true); // calls out but nothing calls it
    expect(orphans.has("ts:a.ts#g")).toBe(false);
  });

  it("flags every node when there are no edges", () => {
    const ns: GraphNode[] = [node("ts:a.ts", "module"), node("ts:b.ts", "module")];
    expect(findOrphanAddresses(ns, []).size).toBe(2);
  });
});
