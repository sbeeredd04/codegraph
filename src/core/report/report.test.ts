import { describe, it, expect } from "vitest";
import { buildMarkdownReport } from "./report.js";
import { GRAPH_SNAPSHOT_VERSION, type GraphSnapshot } from "../graph/export.js";
import type { GraphNode, GraphEdge } from "../graph/types.js";
import type { Diagram } from "../diagrams/diagram.js";
import type { NodeEnrichment } from "../semantic/enrichment.js";

const node = (over: Partial<GraphNode> & { address: string }): GraphNode => ({
  kind: "function",
  name: over.address,
  location: { file: "a.ts", line: 0, character: 0 },
  ...over,
});

const snap = (over: Partial<GraphSnapshot> = {}): GraphSnapshot => {
  const nodes = over.nodes ?? [];
  const edges = over.edges ?? [];
  return {
    version: GRAPH_SNAPSHOT_VERSION,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    ...over,
  };
};

describe("buildMarkdownReport — header & overview", () => {
  it("titles from the repo basename and stamps counts + date", () => {
    const md = buildMarkdownReport(
      snap({
        root: "/Users/x/github/codegraph",
        generatedAt: "2026-06-27T10:00:00.000Z",
        nodes: [node({ address: "ts:a.ts#A" }), node({ address: "ts:a.ts#B" })],
        edges: [{ from: "ts:a.ts#A", to: "ts:a.ts#B", type: "calls" }],
        nodeCount: 2,
        edgeCount: 1,
      }),
    );
    expect(md).toContain("# codegraph — Architecture Report");
    expect(md).toContain("2 nodes");
    expect(md).toContain("1 edges");
    expect(md).toContain("2026-06-27");
  });

  it("falls back to a generic title with no root", () => {
    expect(buildMarkdownReport(snap())).toContain("# Architecture Report");
  });

  it("breaks nodes down by kind in declaration order, only non-zero kinds", () => {
    const md = buildMarkdownReport(
      snap({
        nodes: [
          node({ address: "ts:a.ts", kind: "module" }),
          node({ address: "ts:a.ts#C", kind: "class" }),
          node({ address: "ts:a.ts#C.m", kind: "method" }),
          node({ address: "ts:a.ts#C.n", kind: "method" }),
        ],
      }),
    );
    expect(md).toContain("## Overview");
    expect(md).toMatch(/1 module, 1 class, 2 methods/);
    expect(md).not.toContain("workflow");
  });

  it("reports orphans (nodes touched by no dependency edge)", () => {
    const md = buildMarkdownReport(
      snap({
        nodes: [node({ address: "ts:a.ts#A" }), node({ address: "ts:a.ts#B" }), node({ address: "ts:a.ts#C" })],
        edges: [{ from: "ts:a.ts#A", to: "ts:a.ts#B", type: "calls" }],
      }),
    );
    expect(md).toContain("**Orphans:** 1");
  });

  it("renders a calm report for an empty graph", () => {
    const md = buildMarkdownReport(snap());
    expect(md).toContain("# Architecture Report");
    expect(md).toContain("**Nodes:** 0");
    expect(md).not.toContain("## Most depended-upon");
  });
});

describe("buildMarkdownReport — most depended-upon", () => {
  const nodes = [node({ address: "ts:a.ts#hub" }), node({ address: "ts:a.ts#x" }), node({ address: "ts:a.ts#y" })];
  const edges: GraphEdge[] = [
    { from: "ts:a.ts#x", to: "ts:a.ts#hub", type: "calls" },
    { from: "ts:a.ts#y", to: "ts:a.ts#hub", type: "calls" },
  ];

  it("ranks by transitive dependents and tabulates the top nodes", () => {
    const md = buildMarkdownReport(snap({ nodes, edges }));
    expect(md).toContain("## Most depended-upon");
    expect(md).toMatch(/\|\s*Node\s*\|\s*Kind\s*\|\s*Dependents\s*\|/);
    const hubRow = md.split("\n").find((l) => l.includes("hub"));
    expect(hubRow).toContain("| 2 |");
  });

  it("excludes structural `contains` edges from the dependent count", () => {
    const md = buildMarkdownReport(
      snap({
        nodes: [node({ address: "ts:a.ts", kind: "module" }), node({ address: "ts:a.ts#A" })],
        edges: [{ from: "ts:a.ts", to: "ts:a.ts#A", type: "contains" }],
      }),
    );
    // `contains` is not a dependency, so no node has dependents → section omitted.
    expect(md).not.toContain("## Most depended-upon");
  });

  it("honours topNodes and 0 omits the section", () => {
    expect(buildMarkdownReport(snap({ nodes, edges }), { topNodes: 0 })).not.toContain(
      "## Most depended-upon",
    );
  });

  it("escapes a pipe in a node name so the table is not broken", () => {
    const md = buildMarkdownReport(
      snap({
        nodes: [node({ address: "ts:a.ts#weird", name: "a|b" }), node({ address: "ts:a.ts#u" })],
        edges: [{ from: "ts:a.ts#u", to: "ts:a.ts#weird", type: "calls" }],
      }),
    );
    expect(md).toContain("a\\|b");
  });
});

describe("buildMarkdownReport — diagrams", () => {
  const diagram = (over: Partial<Diagram> & { id: string; title: string; category: string; mermaid: string }): Diagram =>
    over;

  it("groups diagrams by category and embeds each as a mermaid fence", () => {
    const md = buildMarkdownReport(
      snap({
        diagrams: [
          diagram({ id: "architecture/sys", title: "System", category: "architecture", mermaid: "graph TD\nA-->B", description: "the shape" }),
          diagram({ id: "workflow/login", title: "Login", category: "workflow", mermaid: "sequenceDiagram\nA->>B: hi" }),
        ],
      }),
    );
    expect(md).toContain("## Diagrams");
    expect(md).toContain("### Architecture");
    expect(md).toContain("#### System");
    expect(md).toContain("the shape");
    expect(md).toContain("```mermaid\ngraph TD\nA-->B\n```");
    expect(md).toContain("### Workflow");
  });

  it("lengthens the fence when the source itself contains a backtick run", () => {
    const md = buildMarkdownReport(
      snap({ diagrams: [{ id: "other/d", title: "D", category: "other", mermaid: "graph TD\nA[\"```\"]" }] }),
    );
    expect(md).toContain("````mermaid\n");
    expect(md).toContain("\n````");
  });

  it("lists a diagram's related node addresses", () => {
    const md = buildMarkdownReport(
      snap({ diagrams: [{ id: "other/d", title: "D", category: "other", mermaid: "graph TD\nA", related: ["ts:a.ts#A"] }] }),
    );
    expect(md).toContain("ts:a.ts#A");
  });

  it("omits the diagrams section entirely when there are none", () => {
    expect(buildMarkdownReport(snap())).not.toContain("## Diagrams");
  });
});

describe("buildMarkdownReport — annotations", () => {
  const enr = (over: Partial<NodeEnrichment> = {}): NodeEnrichment => ({
    summary: "does a thing",
    intent: "because reasons",
    role: "adapter",
    ...over,
  });

  it("renders role/summary/intent per annotated node, in node order", () => {
    const md = buildMarkdownReport(
      snap({
        nodes: [node({ address: "ts:a.ts#A" }), node({ address: "ts:a.ts#B" })],
        enrichments: {
          "ts:a.ts#B": enr({ summary: "second", role: "port" }),
          "ts:a.ts#A": enr({ summary: "first", role: "core" }),
        },
      }),
    );
    expect(md).toContain("## Annotations");
    expect(md).toContain("ts:a.ts#A");
    expect(md).toContain("**Summary:** first");
    expect(md).toContain("**Role:** core");
    expect(md.indexOf("first")).toBeLessThan(md.indexOf("second")); // node order, not key order
  });

  it("collapses newlines in agent text to keep list items intact", () => {
    const md = buildMarkdownReport(
      snap({
        nodes: [node({ address: "ts:a.ts#A" })],
        enrichments: { "ts:a.ts#A": enr({ summary: "line one\nline two" }) },
      }),
    );
    expect(md).toContain("**Summary:** line one line two");
  });

  it("omits the annotations section when there are none", () => {
    expect(buildMarkdownReport(snap({ nodes: [node({ address: "ts:a.ts#A" })] }))).not.toContain(
      "## Annotations",
    );
  });
});
