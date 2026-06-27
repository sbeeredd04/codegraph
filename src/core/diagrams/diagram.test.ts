import { describe, it, expect } from "vitest";
import {
  DIAGRAM_SET_VERSION,
  slugify,
  diagramId,
  normalizeCategory,
  stripMermaidFence,
  validateDiagram,
  emptyDiagramSet,
  upsertDiagram,
  removeDiagram,
  parseDiagramSet,
  diagramsByCategory,
  type Diagram,
} from "./diagram.js";

const valid = {
  title: "Auth request lifecycle",
  category: "Sequence",
  mermaid: "sequenceDiagram\n  User->>API: login\n  API-->>User: token",
};

describe("slugify", () => {
  it("lowercases, strips punctuation, and collapses to dashes", () => {
    expect(slugify("Auth Request Lifecycle!")).toBe("auth-request-lifecycle");
    expect(slugify("  a/b  c ")).toBe("a-b-c");
    expect(slugify("###")).toBe("");
  });
});

describe("diagramId", () => {
  it("is a stable category/title slug so the same pair upserts in place", () => {
    expect(diagramId("Workflow", "Sign up flow")).toBe("workflow/sign-up-flow");
    expect(diagramId("Workflow", "Sign up flow")).toBe(diagramId("workflow", "SIGN UP FLOW"));
  });
  it("falls back to non-empty parts when a side slugs to empty", () => {
    expect(diagramId("", "###")).toBe("other/diagram");
  });
});

describe("normalizeCategory", () => {
  it("trims and lowercases, defaulting empty to 'other' (agent vocabulary preserved otherwise)", () => {
    expect(normalizeCategory("  Architecture ")).toBe("architecture");
    expect(normalizeCategory("payment-flows")).toBe("payment-flows");
    expect(normalizeCategory("   ")).toBe("other");
  });
});

describe("stripMermaidFence", () => {
  it("unwraps a ```mermaid fenced block the agent may have wrapped it in", () => {
    expect(stripMermaidFence("```mermaid\nflowchart TD\nA-->B\n```")).toBe("flowchart TD\nA-->B");
    expect(stripMermaidFence("```\ngraph LR\nA-->B\n```")).toBe("graph LR\nA-->B");
  });
  it("leaves unfenced source untouched (just trimmed)", () => {
    expect(stripMermaidFence("flowchart TD\n A-->B ")).toBe("flowchart TD\n A-->B");
  });
});

describe("validateDiagram", () => {
  it("accepts a well-formed diagram and computes a stable id", () => {
    const r = validateDiagram(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diagram.id).toBe("sequence/auth-request-lifecycle");
      expect(r.diagram.category).toBe("sequence");
      expect(r.diagram.title).toBe("Auth request lifecycle");
      expect(r.diagram.mermaid).toContain("sequenceDiagram");
    }
  });

  it("rejects a missing or empty title", () => {
    expect(validateDiagram({ ...valid, title: "" }).ok).toBe(false);
    expect(validateDiagram({ ...valid, title: undefined }).ok).toBe(false);
  });

  it("rejects missing or empty mermaid source", () => {
    expect(validateDiagram({ ...valid, mermaid: "   " }).ok).toBe(false);
    expect(validateDiagram({ ...valid, mermaid: 42 }).ok).toBe(false);
  });

  it("rejects mermaid source beyond the size cap (untrusted input guard)", () => {
    expect(validateDiagram({ ...valid, mermaid: "graph LR\n" + "A-->B\n".repeat(20000) }).ok).toBe(false);
  });

  it("strips a fenced mermaid block before storing", () => {
    const r = validateDiagram({ ...valid, mermaid: "```mermaid\nflowchart TD\nA-->B\n```" });
    expect(r.ok && r.diagram.mermaid).toBe("flowchart TD\nA-->B");
  });

  it("keeps an optional description and related node addresses, dropping non-strings", () => {
    const r = validateDiagram({
      ...valid,
      description: "  how a login flows  ",
      related: ["ts:a.ts#login", 7, "ts:b.ts#token", null],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diagram.description).toBe("how a login flows");
      expect(r.diagram.related).toEqual(["ts:a.ts#login", "ts:b.ts#token"]);
    }
  });

  it("omits an empty description and empty related set", () => {
    const r = validateDiagram({ ...valid, description: "   ", related: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diagram.description).toBeUndefined();
      expect(r.diagram.related).toBeUndefined();
    }
  });

  it("passes through an ISO updatedAt when provided (core reads no clock itself)", () => {
    const r = validateDiagram({ ...valid, updatedAt: "2026-06-27T00:00:00.000Z" });
    expect(r.ok && r.diagram.updatedAt).toBe("2026-06-27T00:00:00.000Z");
  });
});

describe("upsertDiagram / removeDiagram", () => {
  const a = (validateDiagram(valid) as { ok: true; diagram: Diagram }).diagram;

  it("appends a new diagram and replaces one with the same id in place", () => {
    const set1 = upsertDiagram(emptyDiagramSet(), a);
    expect(set1.diagrams).toHaveLength(1);
    const a2 = { ...a, title: "Auth request lifecycle", mermaid: "sequenceDiagram\n  X->>Y: hi" };
    const set2 = upsertDiagram(set1, a2);
    expect(set2.diagrams).toHaveLength(1); // same id -> replaced
    expect(set2.diagrams[0].mermaid).toContain("X->>Y");
  });

  it("does not mutate the input set (immutable update)", () => {
    const set1 = upsertDiagram(emptyDiagramSet(), a);
    upsertDiagram(set1, { ...a, id: "other/x" });
    expect(set1.diagrams).toHaveLength(1);
  });

  it("removes by id", () => {
    const set1 = upsertDiagram(emptyDiagramSet(), a);
    expect(removeDiagram(set1, a.id).diagrams).toHaveLength(0);
    expect(removeDiagram(set1, "nope").diagrams).toHaveLength(1);
  });
});

describe("parseDiagramSet", () => {
  it("round-trips a serialized set", () => {
    const a = (validateDiagram(valid) as { ok: true; diagram: Diagram }).diagram;
    const set = upsertDiagram(emptyDiagramSet(), a);
    const r = parseDiagramSet(JSON.stringify(set));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.set.diagrams[0].id).toBe(a.id);
  });

  it("returns a tagged error (never throws) on non-JSON or wrong shape", () => {
    expect(parseDiagramSet("not json").ok).toBe(false);
    expect(parseDiagramSet(JSON.stringify({ version: 1 })).ok).toBe(false);
    expect(parseDiagramSet(JSON.stringify([])).ok).toBe(false);
  });

  it("drops malformed diagram entries but keeps the valid ones (tolerant load)", () => {
    const a = (validateDiagram(valid) as { ok: true; diagram: Diagram }).diagram;
    const raw = { version: DIAGRAM_SET_VERSION, diagrams: [a, { title: "", mermaid: "" }, { junk: true }] };
    const r = parseDiagramSet(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.set.diagrams).toHaveLength(1);
  });
});

describe("diagramsByCategory", () => {
  it("groups diagrams by their category, preserving insertion order", () => {
    const seq = (validateDiagram(valid) as { ok: true; diagram: Diagram }).diagram;
    const arch = (validateDiagram({ ...valid, title: "System layout", category: "architecture" }) as {
      ok: true;
      diagram: Diagram;
    }).diagram;
    const set = upsertDiagram(upsertDiagram(emptyDiagramSet(), seq), arch);
    const grouped = diagramsByCategory(set);
    expect([...grouped.keys()]).toEqual(["sequence", "architecture"]);
    expect(grouped.get("architecture")).toHaveLength(1);
  });
});
