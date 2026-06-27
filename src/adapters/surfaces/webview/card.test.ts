import { describe, it, expect } from "vitest";
import { enrichmentSectionHtml } from "./card.js";

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
