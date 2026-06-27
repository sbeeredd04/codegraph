import { describe, it, expect } from "vitest";
import { buildRenderModel, KIND_COLORS } from "./render-model.js";
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
});
