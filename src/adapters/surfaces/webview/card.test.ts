import { describe, it, expect } from "vitest";
import { enrichmentSectionHtml, orphanNoteHtml, capabilityCardHtml, esc } from "./card.js";

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

describe("esc", () => {
  it("escapes the HTML-significant characters and leaves the rest", () => {
    expect(esc('a & b <i> "x"')).toBe("a &amp; b &lt;i&gt; &quot;x&quot;");
    expect(esc("plain text")).toBe("plain text");
  });
});

describe("capabilityCardHtml", () => {
  const base = {
    label: "createUser",
    kind: "function",
    color: "#5fd39a",
    file: "src/users.ts",
    line: 41,
    groups: [] as ReadonlyArray<readonly [string, readonly string[]]>,
    callers: [] as readonly string[],
  };

  it("renders the title, kind pill with its color, and 1-based location", () => {
    const html = capabilityCardHtml(base);
    expect(html).toContain("<h3>createUser</h3>");
    expect(html).toContain('class="kind"');
    expect(html).toContain("color:#5fd39a");
    expect(html).toContain("function");
    // line is 0-based in the model; the card shows the human 1-based line.
    expect(html).toContain("src/users.ts:42");
  });

  it("renders each out-edge group with its full count and short-named targets", () => {
    const html = capabilityCardHtml({
      ...base,
      groups: [["calls", ["src/db.ts#query", "src/log.ts#info"]]],
    });
    expect(html).toContain("calls (2)");
    // short name = the part after '#', not the whole address.
    expect(html).toContain("<li>query</li>");
    expect(html).toContain("<li>info</li>");
    expect(html).not.toContain("src/db.ts#query");
  });

  it("caps a group list at 8 items but keeps the true count in the header", () => {
    const targets = Array.from({ length: 12 }, (_n, i) => `m#t${i}`);
    const html = capabilityCardHtml({ ...base, groups: [["calls", targets]] });
    expect(html).toContain("calls (12)");
    expect(html).toContain("<li>t0</li>");
    expect(html).toContain("<li>t7</li>");
    expect(html).not.toContain("<li>t8</li>");
  });

  it("renders a 'used by' group when there are callers, omits it when none", () => {
    expect(capabilityCardHtml({ ...base, callers: ["m#caller"] })).toContain("used by (1)");
    expect(capabilityCardHtml({ ...base, callers: ["m#caller"] })).toContain("<li>caller</li>");
    expect(capabilityCardHtml(base)).not.toContain("used by");
  });

  it("includes the agent annotation and the orphan note via the shared builders", () => {
    const enriched = capabilityCardHtml({
      ...base,
      enrichment: { summary: "Creates a user", intent: "", role: "" },
      orphan: true,
    });
    expect(enriched).toContain('class="enrich"');
    expect(enriched).toContain("Creates a user");
    expect(enriched).toContain('class="orphan"');
  });

  it("escapes the title, kind, color, file, and edge names (untrusted addresses)", () => {
    const html = capabilityCardHtml({
      ...base,
      label: "<img src=x>",
      kind: '"><script>',
      file: "a&b.ts",
      groups: [["calls", ["m#<b>evil</b>"]]],
    });
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("a&amp;b.ts");
    expect(html).toContain("&lt;b&gt;evil");
  });
});
