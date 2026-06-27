import { describe, it, expect } from "vitest";
import { highlightName, nodePath, paletteRowsHtml } from "./search-view.js";
import type { NodeSearchResult } from "../../../core/search/node-search.js";

const result = (over: Partial<NodeSearchResult> & { address: string; name: string }): NodeSearchResult => ({
  kind: "function",
  score: 1,
  nameMatches: [],
  ...over,
});

describe("nodePath", () => {
  it("drops the language prefix and the #member suffix", () => {
    expect(nodePath("ts:src/core/report/report.ts#buildMarkdownReport")).toBe("src/core/report/report.ts");
  });
  it("returns the path unchanged when there is no member", () => {
    expect(nodePath("ts:src/core/report/report.ts")).toBe("src/core/report/report.ts");
  });
  it("tolerates an address with no language prefix", () => {
    expect(nodePath("plain#x")).toBe("plain");
  });
});

describe("highlightName", () => {
  it("escapes the name and wraps matched indices in <mark>", () => {
    expect(highlightName("activate", [0, 1, 2])).toBe("<mark>act</mark>ivate");
  });
  it("groups contiguous matches into one <mark> and splits on gaps", () => {
    expect(highlightName("CodeGraph", [0, 4])).toBe("<mark>C</mark>ode<mark>G</mark>raph");
  });
  it("just escapes when there are no matches", () => {
    expect(highlightName("a<b>", [])).toBe("a&lt;b&gt;");
  });
  it("escapes matched characters too (no HTML injection through a node name)", () => {
    expect(highlightName("<x", [0])).toBe("<mark>&lt;</mark>x");
  });
});

describe("paletteRowsHtml", () => {
  it("emits one option row per result with the address, kind and path", () => {
    const html = paletteRowsHtml([
      result({ address: "ts:src/a.ts#foo", name: "foo", kind: "function", nameMatches: [0] }),
    ]);
    expect(html).toContain('role="option"');
    expect(html).toContain('id="cp-opt-0"');
    expect(html).toContain('data-addr="ts:src/a.ts#foo"');
    expect(html).toContain('data-kind="function"');
    expect(html).toContain("src/a.ts");
    expect(html).toContain("<mark>f</mark>oo");
    expect(html).toContain('aria-selected="false"');
  });

  it("indexes rows sequentially", () => {
    const html = paletteRowsHtml([
      result({ address: "x#a", name: "a" }),
      result({ address: "x#b", name: "b" }),
    ]);
    expect(html).toContain('id="cp-opt-0"');
    expect(html).toContain('id="cp-opt-1"');
  });

  it("escapes a malicious name and address", () => {
    const html = paletteRowsHtml([
      result({ address: 'x#"><img>', name: '"><img src=x onerror=alert(1)>' }),
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("returns an empty string for no results", () => {
    expect(paletteRowsHtml([])).toBe("");
  });
});
