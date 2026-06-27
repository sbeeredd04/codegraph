import { describe, it, expect } from "vitest";
import { exportGraphSnapshot, GRAPH_SNAPSHOT_VERSION } from "./export.js";
import type { GraphNode, GraphEdge } from "./types.js";
import type { NodeEnrichment } from "../semantic/enrichment.js";

const node = (address: string, kind: GraphNode["kind"]): GraphNode => ({
  address,
  kind,
  name: address.split("#").pop() ?? address,
  location: { file: "a.ts", line: 0, character: 0 },
});

const nodes: GraphNode[] = [node("ts:a.ts", "module"), node("ts:a.ts#A", "class")];
const edges: GraphEdge[] = [{ from: "ts:a.ts", to: "ts:a.ts#A", type: "contains" }];

describe("exportGraphSnapshot", () => {
  it("stamps the schema version and accurate counts", () => {
    const snap = exportGraphSnapshot(nodes, edges);
    expect(snap.version).toBe(GRAPH_SNAPSHOT_VERSION);
    expect(snap.nodeCount).toBe(2);
    expect(snap.edgeCount).toBe(1);
    expect(snap.nodes).toEqual(nodes);
    expect(snap.edges).toEqual(edges);
  });

  it("is JSON round-trippable (a portable, self-contained artifact)", () => {
    const snap = exportGraphSnapshot(nodes, edges);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("includes the injected metadata without reaching for a clock itself (pure core)", () => {
    const snap = exportGraphSnapshot(nodes, edges, {
      generatedAt: "2026-06-27T00:00:00.000Z",
      root: "/repo",
    });
    expect(snap.generatedAt).toBe("2026-06-27T00:00:00.000Z");
    expect(snap.root).toBe("/repo");
  });

  it("folds an enrichments map into a plain object keyed by address, only for annotated nodes", () => {
    const enrichments = new Map<string, NodeEnrichment>([
      ["ts:a.ts#A", { summary: "the A class", intent: "model A", role: "value object" }],
    ]);
    const snap = exportGraphSnapshot(nodes, edges, { enrichments });
    expect(snap.enrichments).toEqual({
      "ts:a.ts#A": { summary: "the A class", intent: "model A", role: "value object" },
    });
  });

  it("omits the enrichments key entirely when there are none (clean, minimal output)", () => {
    expect(exportGraphSnapshot(nodes, edges).enrichments).toBeUndefined();
    expect(exportGraphSnapshot(nodes, edges, { enrichments: new Map() }).enrichments).toBeUndefined();
  });
});
