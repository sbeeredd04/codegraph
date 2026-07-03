import { describe, it, expect } from "vitest";
import { searchNodes, parseScopedQuery, type SearchableNode } from "./node-search.js";

const n = (address: string, name: string, kind = "function"): SearchableNode => ({ address, name, kind });

const nodes: SearchableNode[] = [
  n("ts:src/core/report/report.ts#buildMarkdownReport", "buildMarkdownReport"),
  n("ts:src/core/graph/graph.ts#CodeGraph", "CodeGraph", "class"),
  n("ts:src/core/graph/reachability.ts#transitiveClosure", "transitiveClosure"),
  n("ts:src/extension/index.ts#activate", "activate"),
  n("ts:src/core/report/report.ts", "report.ts", "module"),
];

const names = (q: string, opts?: Parameters<typeof searchNodes>[2]) =>
  searchNodes(nodes, q, opts).map((r) => r.name);

describe("searchNodes — matching", () => {
  it("returns the input nodes (capped) for an empty query, in order", () => {
    const r = searchNodes(nodes, "");
    expect(r.map((x) => x.name)).toEqual(nodes.map((x) => x.name));
    expect(r[0].score).toBe(0);
    expect(r[0].nameMatches).toEqual([]);
  });

  it("treats a whitespace-only query as empty", () => {
    expect(searchNodes(nodes, "   ").length).toBe(nodes.length);
  });

  it("excludes nodes whose name and address share no subsequence with the query", () => {
    expect(names("zzqq")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(names("CODEGRAPH")).toContain("CodeGraph");
    expect(names("codegraph")).toContain("CodeGraph");
  });

  it("ranks an exact name match first", () => {
    expect(names("activate")[0]).toBe("activate");
  });

  it("ranks a prefix match above a mid-string subsequence match", () => {
    const r = names("report");
    // `report.ts` (prefix) should outrank `buildMarkdownReport` (suffix match).
    expect(r.indexOf("report.ts")).toBeLessThan(r.indexOf("buildMarkdownReport"));
  });

  it("matches a camelCase acronym to its node and ranks it top", () => {
    expect(names("bmr")[0]).toBe("buildMarkdownReport");
  });

  it("matches against the address/path when the name does not match", () => {
    // No node is *named* with a dotted path, but two live under report.ts.
    const r = names("reachability.ts");
    expect(r).toContain("transitiveClosure");
  });

  it("honours the result limit", () => {
    expect(searchNodes(nodes, "", { limit: 2 }).length).toBe(2);
  });
});

describe("searchNodes — highlight ranges", () => {
  it("reports the matched indices within the name for a contiguous match", () => {
    const r = searchNodes([n("x#activate", "activate")], "act");
    expect(r[0].nameMatches).toEqual([0, 1, 2]);
  });

  it("reports subsequence indices for a fuzzy name match", () => {
    const r = searchNodes([n("x#CodeGraph", "CodeGraph")], "cg");
    expect(r[0].nameMatches).toEqual([0, 4]); // C…G
  });

  it("leaves nameMatches empty when only the address matched", () => {
    const r = searchNodes([n("ts:src/a/reachability.ts#run", "run")], "reachability");
    expect(r[0].name).toBe("run");
    expect(r[0].nameMatches).toEqual([]);
  });
});

describe("searchNodes — ordering", () => {
  it("sorts by score descending then name ascending", () => {
    const set: SearchableNode[] = [
      n("x#alpha", "alpha"),
      n("x#alphabet", "alphabet"),
      n("x#al", "al"),
    ];
    const r = searchNodes(set, "al").map((x) => x.name);
    // `al` is an exact match (top); the prefix matches follow, shorter name first on tie.
    expect(r[0]).toBe("al");
    expect(r).toContain("alpha");
    expect(r).toContain("alphabet");
  });

  it("returns scores in non-increasing order", () => {
    const r = searchNodes(nodes, "re").map((x) => x.score);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThanOrEqual(r[i - 1]);
  });
});

describe("searchNodes — kind filter (FR-74)", () => {
  it("restricts scored results to the requested kinds", () => {
    // "report" matches report.ts (module) and buildMarkdownReport (function); a
    // file: scope keeps only the module.
    const r = searchNodes(nodes, "report", { kinds: ["module"] }).map((x) => x.name);
    expect(r).toEqual(["report.ts"]);
  });

  it("lists a whole kind for a bare scope (empty query + kinds)", () => {
    const r = searchNodes(nodes, "", { kinds: ["class"] }).map((x) => x.name);
    expect(r).toEqual(["CodeGraph"]);
  });

  it("is case-insensitive on the kind and ignores an empty kinds array", () => {
    expect(searchNodes(nodes, "", { kinds: ["MODULE"] }).map((x) => x.name)).toEqual(["report.ts"]);
    expect(searchNodes(nodes, "", { kinds: [] }).length).toBe(nodes.length);
  });

  it("carries an optional path field through to results", () => {
    const withPath: SearchableNode = { address: "x#run", name: "run", kind: "function", path: "src/a.ts" };
    expect(searchNodes([withPath], "run")[0].path).toBe("src/a.ts");
  });
});

describe("parseScopedQuery (FR-74)", () => {
  it("splits a known prefix into kinds + stripped text + label", () => {
    expect(parseScopedQuery("fn:parse")).toEqual({ kinds: ["function"], scopeLabel: "functions", text: "parse" });
    expect(parseScopedQuery("file:report")).toEqual({ kinds: ["module"], scopeLabel: "files", text: "report" });
    expect(parseScopedQuery("class:Graph")).toEqual({ kinds: ["class"], scopeLabel: "classes", text: "Graph" });
  });

  it("treats a bare prefix as scope with empty text", () => {
    expect(parseScopedQuery("fn:")).toEqual({ kinds: ["function"], scopeLabel: "functions", text: "" });
  });

  it("is case-insensitive on the prefix and trims leading space in the text", () => {
    expect(parseScopedQuery("FN: parse").text).toBe("parse");
    expect(parseScopedQuery("Method:run").kinds).toEqual(["method"]);
  });

  it("leaves an unknown or absent prefix untouched (never mangles a plain query or URL)", () => {
    expect(parseScopedQuery("parse")).toEqual({ kinds: null, scopeLabel: null, text: "parse" });
    expect(parseScopedQuery("http://x")).toEqual({ kinds: null, scopeLabel: null, text: "http://x" });
  });
});
