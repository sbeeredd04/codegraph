import { describe, it, expect } from "vitest";
import type { GraphNode } from "../../../core/graph/types.js";
import type { NodeEnrichment } from "../../../core/semantic/enrichment.js";
import type { Diagram, DiagramSet } from "../../../core/diagrams/diagram.js";
import { DIAGRAM_SET_VERSION } from "../../../core/diagrams/diagram.js";
import { buildKnowledgeIndex, knowledgeIndexHtml } from "./knowledge-view.js";

const node = (over: Partial<GraphNode> & { address: string }): GraphNode => ({
  kind: over.kind ?? "function",
  name: over.name ?? over.address,
  location: over.location ?? { file: "a.ts", line: 1, character: 0 },
  ...over,
});

const enrich = (over: Partial<NodeEnrichment>): NodeEnrichment => ({
  summary: over.summary ?? "Does a thing.",
  intent: over.intent ?? "Because.",
  role: over.role ?? "service",
});

const diagram = (over: Partial<Diagram>): Diagram => ({
  id: over.id ?? "workflow/login",
  title: over.title ?? "Login flow",
  category: over.category ?? "workflow",
  mermaid: over.mermaid ?? "flowchart TD\n A-->B",
  ...(over.description ? { description: over.description } : {}),
  ...(over.related ? { related: over.related } : {}),
});

const setOf = (...diagrams: Diagram[]): DiagramSet => ({ version: DIAGRAM_SET_VERSION, diagrams });
const mapOf = (m: Record<string, NodeEnrichment>): ReadonlyMap<string, NodeEnrichment> =>
  new Map(Object.entries(m));

describe("buildKnowledgeIndex", () => {
  it("groups annotated nodes by role (first-seen order) and counts annotated vs total", () => {
    const nodes = [
      node({ address: "a", name: "a" }),
      node({ address: "b", name: "b" }),
      node({ address: "c", name: "c" }),
      node({ address: "d", name: "d" }), // no enrichment
    ];
    const model = buildKnowledgeIndex(
      nodes,
      mapOf({
        a: enrich({ role: "port" }),
        b: enrich({ role: "adapter" }),
        c: enrich({ role: "port" }),
      }),
      setOf(),
    );
    expect(model.totalNodes).toBe(4);
    expect(model.annotatedCount).toBe(3);
    expect(model.roleGroups.map((g) => g.role)).toEqual(["port", "adapter"]); // first-seen
    expect(model.roleGroups[0].entries.map((e) => e.address)).toEqual(["a", "c"]);
    expect(model.roleGroups[1].entries.map((e) => e.address)).toEqual(["b"]);
  });

  it("ignores nodes with no enrichment (only annotated nodes appear)", () => {
    const model = buildKnowledgeIndex(
      [node({ address: "a" }), node({ address: "b" })],
      mapOf({ a: enrich({}) }),
      setOf(),
    );
    expect(model.annotatedCount).toBe(1);
    expect(model.roleGroups.flatMap((g) => g.entries.map((e) => e.address))).toEqual(["a"]);
  });

  it("falls back to 'Unclassified' for a blank/whitespace role", () => {
    const model = buildKnowledgeIndex(
      [node({ address: "a" })],
      mapOf({ a: enrich({ role: "   " }) }),
      setOf(),
    );
    expect(model.roleGroups[0].role).toBe("Unclassified");
  });

  it("carries the node's display name, kind, and summary into each entry", () => {
    const model = buildKnowledgeIndex(
      [node({ address: "ts:m.ts#run", name: "run", kind: "method" })],
      mapOf({ "ts:m.ts#run": enrich({ summary: "Runs the loop." }) }),
      setOf(),
    );
    const e = model.roleGroups[0].entries[0];
    expect(e).toMatchObject({ address: "ts:m.ts#run", name: "run", kind: "method", summary: "Runs the loop." });
  });

  it("groups diagrams by category and counts them", () => {
    const model = buildKnowledgeIndex(
      [],
      mapOf({}),
      setOf(
        diagram({ id: "workflow/a", category: "workflow" }),
        diagram({ id: "architecture/b", category: "architecture" }),
        diagram({ id: "workflow/c", category: "workflow" }),
      ),
    );
    expect(model.diagramCount).toBe(3);
    expect(model.diagramGroups.map((g) => g.category)).toEqual(["workflow", "architecture"]);
    expect(model.diagramGroups[0].diagrams.map((d) => d.id)).toEqual(["workflow/a", "workflow/c"]);
  });

  it("is fully empty when there are no annotations and no diagrams", () => {
    const model = buildKnowledgeIndex([node({ address: "a" })], mapOf({}), setOf());
    expect(model.annotatedCount).toBe(0);
    expect(model.diagramCount).toBe(0);
    expect(model.roleGroups).toEqual([]);
    expect(model.diagramGroups).toEqual([]);
  });
});

describe("knowledgeIndexHtml", () => {
  it("renders a role header and a node button tagged with its address, showing name + summary", () => {
    const html = knowledgeIndexHtml(
      buildKnowledgeIndex(
        [node({ address: "ts:m.ts#run", name: "run" })],
        mapOf({ "ts:m.ts#run": enrich({ role: "orchestrator", summary: "Drives the loop." }) }),
        setOf(),
      ),
    );
    expect(html).toContain("orchestrator");
    expect(html).toContain('data-addr="ts:m.ts#run"');
    expect(html).toContain(">run<");
    expect(html).toContain("Drives the loop.");
    expect(html).toContain("<button");
  });

  it("renders a diagram button tagged with its id and title", () => {
    const html = knowledgeIndexHtml(
      buildKnowledgeIndex([], mapOf({}), setOf(diagram({ id: "workflow/login", title: "Login flow" }))),
    );
    expect(html).toContain('data-id="workflow/login"');
    expect(html).toContain("Login flow");
  });

  it("escapes a malicious role, summary, and diagram title (agent text is untrusted)", () => {
    const html = knowledgeIndexHtml(
      buildKnowledgeIndex(
        [node({ address: "a", name: `<img src=x onerror=alert(1)>` })],
        mapOf({ a: enrich({ role: `r"<b>`, summary: `s & "x"` }) }),
        setOf(diagram({ title: `<script>bad()</script>` })),
      ),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("r&quot;&lt;b&gt;");
    expect(html).toContain("s &amp; &quot;x&quot;");
  });

  it("shows an onboarding empty state (naming both write tools) when nothing is captured", () => {
    const html = knowledgeIndexHtml(buildKnowledgeIndex([], mapOf({}), setOf()));
    expect(html).not.toContain("<button");
    expect(html).toContain("annotate_node");
    expect(html).toContain("save_diagram");
  });
});
