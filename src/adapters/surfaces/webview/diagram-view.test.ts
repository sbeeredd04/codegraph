import { describe, it, expect } from "vitest";
import type { Diagram, DiagramSet } from "../../../core/diagrams/diagram.js";
import { DIAGRAM_SET_VERSION } from "../../../core/diagrams/diagram.js";
import { buildDiagramPanel, diagramIndexHtml, relatedChipsHtml } from "./diagram-view.js";

const diagram = (over: Partial<Diagram>): Diagram => ({
  id: over.id ?? "workflow/login",
  title: over.title ?? "Login flow",
  category: over.category ?? "workflow",
  mermaid: over.mermaid ?? "flowchart TD\n A-->B",
  ...(over.description ? { description: over.description } : {}),
  ...(over.related ? { related: over.related } : {}),
});

const setOf = (...diagrams: Diagram[]): DiagramSet => ({ version: DIAGRAM_SET_VERSION, diagrams });

describe("buildDiagramPanel", () => {
  it("groups diagrams by category and counts the total", () => {
    const model = buildDiagramPanel(
      setOf(
        diagram({ id: "workflow/login", title: "Login", category: "workflow" }),
        diagram({ id: "architecture/overview", title: "Overview", category: "architecture" }),
        diagram({ id: "workflow/checkout", title: "Checkout", category: "workflow" }),
      ),
    );
    expect(model.count).toBe(3);
    expect(model.groups.map((g) => g.category)).toEqual(["workflow", "architecture"]); // first-seen order
    expect(model.groups[0].diagrams).toHaveLength(2);
    expect(model.groups[1].diagrams).toHaveLength(1);
  });

  it("returns an empty model for a set with no diagrams", () => {
    const model = buildDiagramPanel(setOf());
    expect(model.count).toBe(0);
    expect(model.groups).toEqual([]);
  });

  it("carries the mermaid source and related addresses through for webview lookup", () => {
    const model = buildDiagramPanel(
      setOf(diagram({ mermaid: "graph LR\n X-->Y", related: ["ts:m.ts#foo"] })),
    );
    const view = model.groups[0].diagrams[0];
    expect(view.mermaid).toBe("graph LR\n X-->Y");
    expect(view.related).toEqual(["ts:m.ts#foo"]);
  });
});

describe("diagramIndexHtml", () => {
  it("renders a category header and a button per diagram, tagged with its id", () => {
    const html = diagramIndexHtml(
      buildDiagramPanel(setOf(diagram({ id: "workflow/login", title: "Login flow", category: "workflow" }))),
    );
    expect(html).toContain("workflow");
    expect(html).toContain('data-id="workflow/login"');
    expect(html).toContain("Login flow");
    expect(html).toContain("<button");
  });

  it("escapes a malicious title so it cannot inject markup (XSS guard)", () => {
    const html = diagramIndexHtml(
      buildDiagramPanel(setOf(diagram({ title: `<img src=x onerror="alert(1)">` }))),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes the category and description too", () => {
    const html = diagramIndexHtml(
      buildDiagramPanel(
        setOf(diagram({ category: "a<b", description: `d & "e"` })),
      ),
    );
    expect(html).toContain("a&lt;b");
    expect(html).toContain("d &amp; &quot;e&quot;");
    expect(html).not.toContain("a<b");
  });

  it("shows an onboarding empty state (no buttons) when there are no diagrams", () => {
    const html = diagramIndexHtml(buildDiagramPanel(setOf()));
    expect(html).not.toContain("<button");
    expect(html.toLowerCase()).toContain("save_diagram");
  });
});

describe("relatedChipsHtml", () => {
  it("renders one button per related address, carrying the full address and a short label", () => {
    const html = relatedChipsHtml(["ts:m.ts#foo", "py:pkg/mod.py#Bar.baz"]);
    expect(html).toContain('data-addr="ts:m.ts#foo"');
    expect(html).toContain(">foo<"); // short label = the member after '#'
    expect(html).toContain('data-addr="py:pkg/mod.py#Bar.baz"');
    expect(html).toContain(">Bar.baz<");
    expect((html.match(/<button/g) ?? []).length).toBe(2);
  });

  it("uses the whole address as the label when there is no member (a module)", () => {
    const html = relatedChipsHtml(["ts:a.ts"]);
    expect(html).toContain('data-addr="ts:a.ts"');
    expect(html).toContain(">ts:a.ts<");
  });

  it("returns an empty string for no related addresses (chip row stays hidden)", () => {
    expect(relatedChipsHtml([])).toBe("");
    expect(relatedChipsHtml(undefined)).toBe("");
  });

  it("escapes a malicious address so it cannot inject markup (agent text is untrusted)", () => {
    const html = relatedChipsHtml([`ts:a.ts#"><img src=x onerror=alert(1)>`]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;&gt;&lt;img src=x");
  });
});
