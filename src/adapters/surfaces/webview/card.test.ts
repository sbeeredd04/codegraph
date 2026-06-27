import { describe, it, expect } from "vitest";
import { enrichmentSectionHtml, orphanNoteHtml } from "./card.js";

describe("enrichmentSectionHtml", () => {
  it("returns empty string when there is no enrichment or no summary", () => {
    expect(enrichmentSectionHtml(undefined)).toBe("");
    expect(enrichmentSectionHtml({ summary: "  ", intent: "x", role: "y" })).toBe("");
  });

  it("renders the summary as the lead inside the enrich container", () => {
    const html = enrichmentSectionHtml({ summary: "Authenticates a user", intent: "", role: "" });
    expect(html).toContain('class="enrich"');
    expect(html).toContain('class="summary"');
    expect(html).toContain("Authenticates a user");
  });

  it("renders the role as a pill when present, omits it when empty", () => {
    expect(enrichmentSectionHtml({ summary: "s", intent: "", role: "orchestrator" })).toContain('class="role"');
    expect(enrichmentSectionHtml({ summary: "s", intent: "", role: "orchestrator" })).toContain("orchestrator");
    expect(enrichmentSectionHtml({ summary: "s", intent: "", role: "" })).not.toContain('class="role"');
  });

  it("renders intent as supporting text when present, omits when empty", () => {
    expect(enrichmentSectionHtml({ summary: "s", intent: "gate access", role: "" })).toContain("gate access");
    expect(enrichmentSectionHtml({ summary: "s", intent: "gate access", role: "" })).toContain('class="intent"');
    expect(enrichmentSectionHtml({ summary: "s", intent: "", role: "" })).not.toContain('class="intent"');
  });

  it("escapes HTML in every field (agent-written text is untrusted — no injection)", () => {
    const html = enrichmentSectionHtml({
      summary: "<img src=x onerror=alert(1)>",
      intent: "a & b <b>",
      role: "<script>",
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
  });
});

describe("orphanNoteHtml", () => {
  it("returns empty string for a node that has callers (not an orphan)", () => {
    expect(orphanNoteHtml(false)).toBe("");
    expect(orphanNoteHtml(undefined)).toBe("");
  });

  it("renders a calm, hedged dead-code-candidate chip for an orphan", () => {
    const html = orphanNoteHtml(true);
    expect(html).toContain('class="orphan"');
    expect(html).toContain("no callers");
    // Honest microcopy: it's a candidate, not a verdict — entry points are orphans too.
    expect(html.toLowerCase()).toContain("candidate");
  });
});
