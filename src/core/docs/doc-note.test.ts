import { describe, it, expect } from "vitest";
import { extractDocSummary, deriveFallbackNote } from "./doc-note.js";

describe("extractDocSummary", () => {
  it("pulls the summary line out of a JSDoc block and drops @tags", () => {
    const raw = `/**
 * Adds two numbers together.
 * @param a the first addend
 * @returns the sum
 */`;
    expect(extractDocSummary(raw)).toBe("Adds two numbers together.");
  });

  it("joins a wrapped multi-line JSDoc summary into one line", () => {
    const raw = `/**
 * Resolves the dependency graph for a module by walking its
 * import statements transitively.
 */`;
    expect(extractDocSummary(raw)).toBe(
      "Resolves the dependency graph for a module by walking its import statements transitively.",
    );
  });

  it("reads a one-line Python docstring", () => {
    expect(extractDocSummary('"""Return the user with the given id."""')).toBe(
      "Return the user with the given id.",
    );
  });

  it("takes the first paragraph of a Python docstring and stops at section headers", () => {
    const raw = `"""Fetch a user by id.

    Args:
        id: the user id
    Returns:
        the user
    """`;
    expect(extractDocSummary(raw)).toBe("Fetch a user by id.");
  });

  it("stops at a Google-style section header even without a blank line", () => {
    const raw = `"""Compute a checksum.
    Returns: the 8-char hex digest
    """`;
    expect(extractDocSummary(raw)).toBe("Compute a checksum.");
  });

  it("strips // and # leading line comments", () => {
    expect(extractDocSummary("// Builds the prompt for one node.")).toBe(
      "Builds the prompt for one node.",
    );
    expect(extractDocSummary("# Compute the FNV-1a hash.")).toBe("Compute the FNV-1a hash.");
  });

  it("joins a run of // comment lines until a blank line", () => {
    expect(extractDocSummary("// Caches the result\n// so we never re-spend.")).toBe(
      "Caches the result so we never re-spend.",
    );
  });

  it("returns null for empty, whitespace, or tag-only comments", () => {
    expect(extractDocSummary("")).toBeNull();
    expect(extractDocSummary("   \n  ")).toBeNull();
    expect(extractDocSummary("/** @internal */")).toBeNull();
    expect(extractDocSummary(undefined)).toBeNull();
    expect(extractDocSummary(null)).toBeNull();
  });

  it("clamps long prose on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(80).trim();
    const out = extractDocSummary(long)!;
    expect(out.length).toBeLessThanOrEqual(220);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("wor…"); // cut on a space, not mid-word
  });

  it("preserves markup as literal text (escaping is the renderer's job)", () => {
    expect(extractDocSummary("/** Renders <b>bold</b> safely. */")).toBe(
      "Renders <b>bold</b> safely.",
    );
  });

  it("skips leading blank lines inside a block", () => {
    expect(extractDocSummary("/**\n *\n * The real summary.\n */")).toBe("The real summary.");
  });
});

describe("deriveFallbackNote", () => {
  it("derives a docstring-sourced note when the node carries a doc", () => {
    expect(deriveFallbackNote({ doc: "/** Logs the user in. */" })).toEqual({
      body: "Logs the user in.",
      source: "docstring",
    });
  });

  it("returns null when the node has no doc or it cleans to nothing", () => {
    expect(deriveFallbackNote({})).toBeNull();
    expect(deriveFallbackNote({ doc: "/** @returns void */" })).toBeNull();
  });
});
