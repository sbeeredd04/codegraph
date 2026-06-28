import { describe, it, expect } from "vitest";
import {
  DOC_SET_VERSION,
  slugify,
  docId,
  normalizeCategory,
  validateDoc,
  emptyDocSet,
  upsertDoc,
  removeDoc,
  parseDocSet,
  docsByCategory,
  type Doc,
} from "./doc.js";

const valid = {
  title: "Getting started",
  category: "Onboarding",
  markdown: "# Getting started\n\nClone the repo and run `npm install`.",
};

describe("slugify / docId", () => {
  it("lowercases, strips punctuation, and collapses to dashes", () => {
    expect(slugify("Getting Started!")).toBe("getting-started");
    expect(slugify("  a/b  c ")).toBe("a-b-c");
    expect(slugify("###")).toBe("");
  });

  it("builds a category/title id with safe fallbacks", () => {
    expect(docId("Onboarding", "Getting Started")).toBe("onboarding/getting-started");
    expect(docId("", "")).toBe("other/doc");
  });
});

describe("normalizeCategory", () => {
  it("trims and lowercases, defaulting empty to guide", () => {
    expect(normalizeCategory("  Architecture ")).toBe("architecture");
    expect(normalizeCategory("")).toBe("guide");
  });
});

describe("validateDoc", () => {
  it("accepts a well-formed doc and assigns a stable id", () => {
    const r = validateDoc(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.id).toBe("onboarding/getting-started");
      expect(r.doc.category).toBe("onboarding");
      expect(r.doc.markdown).toContain("# Getting started");
    }
  });

  it("rejects a missing title", () => {
    const r = validateDoc({ ...valid, title: "   " });
    expect(r.ok).toBe(false);
  });

  it("rejects non-string or empty markdown", () => {
    expect(validateDoc({ ...valid, markdown: 42 }).ok).toBe(false);
    expect(validateDoc({ ...valid, markdown: "   " }).ok).toBe(false);
  });

  it("keeps only non-empty related addresses, else omits the key", () => {
    const r = validateDoc({ ...valid, related: ["ts:a", "  ", 7, "ts:b"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.related).toEqual(["ts:a", "ts:b"]);
    const none = validateDoc({ ...valid, related: ["  ", ""] });
    expect(none.ok && none.doc.related).toBeUndefined();
  });
});

describe("upsertDoc / removeDoc", () => {
  it("replaces in place by id and removes by id", () => {
    const a = validateDoc(valid);
    const b = validateDoc({ ...valid, markdown: "# Getting started\n\nUpdated." });
    if (!a.ok || !b.ok) throw new Error("fixtures invalid");
    let set = upsertDoc(emptyDocSet(), a.doc);
    set = upsertDoc(set, b.doc);
    expect(set.docs).toHaveLength(1);
    expect(set.docs[0].markdown).toContain("Updated");
    set = removeDoc(set, b.doc.id);
    expect(set.docs).toHaveLength(0);
  });
});

describe("parseDocSet", () => {
  it("drops malformed docs but keeps the valid ones (never fails the load)", () => {
    const text = JSON.stringify({
      version: DOC_SET_VERSION,
      docs: [valid, { title: "" }, { title: "No body" }],
    });
    const r = parseDocSet(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.set.docs).toHaveLength(1);
      expect(r.set.docs[0].title).toBe("Getting started");
    }
  });

  it("rejects non-JSON and a missing docs array", () => {
    expect(parseDocSet("not json").ok).toBe(false);
    expect(parseDocSet(JSON.stringify({ version: 1 })).ok).toBe(false);
  });
});

describe("docsByCategory", () => {
  it("groups by category in first-seen order", () => {
    const mk = (title: string, category: string): Doc => {
      const r = validateDoc({ title, category, markdown: "# x" });
      if (!r.ok) throw new Error("bad fixture");
      return r.doc;
    };
    const set = { version: 1, docs: [mk("a", "guide"), mk("b", "module"), mk("c", "guide")] };
    const groups = docsByCategory(set);
    expect([...groups.keys()]).toEqual(["guide", "module"]);
    expect(groups.get("guide")).toHaveLength(2);
  });
});
