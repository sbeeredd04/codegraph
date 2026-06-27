import { describe, it, expect } from "vitest";
import { exportGraphSnapshot, parseGraphSnapshot, GRAPH_SNAPSHOT_VERSION } from "./export.js";
import type { GraphNode, GraphEdge } from "./types.js";
import type { NodeEnrichment } from "../semantic/enrichment.js";
import type { Diagram } from "../diagrams/diagram.js";

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

  it("folds the agent's diagrams into the snapshot so the artifact carries the narrative", () => {
    const diagrams: Diagram[] = [
      { id: "workflow/login", title: "Login", category: "workflow", mermaid: "flowchart TD\n A-->B" },
    ];
    const snap = exportGraphSnapshot(nodes, edges, { diagrams });
    expect(snap.diagrams).toEqual(diagrams);
  });

  it("omits the diagrams key entirely when there are none", () => {
    expect(exportGraphSnapshot(nodes, edges).diagrams).toBeUndefined();
    expect(exportGraphSnapshot(nodes, edges, { diagrams: [] }).diagrams).toBeUndefined();
  });
});

describe("parseGraphSnapshot", () => {
  it("round-trips a snapshot produced by exportGraphSnapshot", () => {
    const text = JSON.stringify(exportGraphSnapshot(nodes, edges, { root: "/repo" }));
    const result = parseGraphSnapshot(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.nodes).toEqual(nodes);
      expect(result.snapshot.edges).toEqual(edges);
      expect(result.snapshot.root).toBe("/repo");
    }
  });

  it("rejects text that is not valid JSON", () => {
    const result = parseGraphSnapshot("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/json/i);
  });

  it("rejects a non-object payload", () => {
    expect(parseGraphSnapshot("42").ok).toBe(false);
    expect(parseGraphSnapshot("null").ok).toBe(false);
    expect(parseGraphSnapshot('"a string"').ok).toBe(false);
  });

  it("rejects an unsupported schema version", () => {
    const result = parseGraphSnapshot(JSON.stringify({ version: 999, nodes: [], edges: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version/i);
  });

  it("rejects a payload missing the nodes or edges arrays", () => {
    expect(parseGraphSnapshot(JSON.stringify({ version: GRAPH_SNAPSHOT_VERSION, edges: [] })).ok).toBe(false);
    expect(parseGraphSnapshot(JSON.stringify({ version: GRAPH_SNAPSHOT_VERSION, nodes: [] })).ok).toBe(false);
  });

  it("accepts a minimal valid snapshot", () => {
    const result = parseGraphSnapshot(JSON.stringify({ version: GRAPH_SNAPSHOT_VERSION, nodes: [], edges: [] }));
    expect(result.ok).toBe(true);
  });

  it("round-trips the diagrams carried by a snapshot", () => {
    const diagrams: Diagram[] = [
      { id: "workflow/login", title: "Login", category: "workflow", mermaid: "flowchart TD\n A-->B" },
    ];
    const text = JSON.stringify(exportGraphSnapshot(nodes, edges, { diagrams }));
    const result = parseGraphSnapshot(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.diagrams).toEqual(diagrams);
  });

  it("re-validates diagrams (untrusted file): drops the malformed, keeps the valid, never fails the snapshot", () => {
    const raw = {
      version: GRAPH_SNAPSHOT_VERSION,
      nodes: [],
      edges: [],
      diagrams: [
        { title: "OK", category: "workflow", mermaid: "flowchart TD\n A-->B" },
        { title: "", mermaid: "" }, // invalid: no title, no source
        "not even an object",
      ],
    };
    const result = parseGraphSnapshot(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.diagrams).toHaveLength(1);
      expect(result.snapshot.diagrams?.[0]?.title).toBe("OK");
    }
  });

  it("leaves diagrams undefined when a snapshot carries none", () => {
    const result = parseGraphSnapshot(JSON.stringify(exportGraphSnapshot(nodes, edges)));
    expect(result.ok && result.snapshot.diagrams).toBeUndefined();
  });
});
