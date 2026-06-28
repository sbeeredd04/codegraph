import { describe, it, expect } from "vitest";
import { buildAskPrompt, canBuildAskPrompt, ASSIST_QUERY_TOOLS } from "./ask.js";

describe("canBuildAskPrompt", () => {
  it("requires a non-empty question", () => {
    expect(canBuildAskPrompt({ question: "" })).toBe(false);
    expect(canBuildAskPrompt({ question: "   \n  " })).toBe(false);
    expect(canBuildAskPrompt({ question: "how does auth work?" })).toBe(true);
  });
});

describe("buildAskPrompt", () => {
  it("embeds the cleaned question and references real query tools", () => {
    const p = buildAskPrompt({ question: "  How   does\n auth  work? " });
    expect(p).toContain("How does auth work?");
    for (const tool of ASSIST_QUERY_TOOLS) expect(p).toContain(tool);
    expect(p).toContain("save_diagram");
  });

  it("anchors on the focused node and lists its neighbours when provided", () => {
    const p = buildAskPrompt({
      question: "what calls this?",
      focus: { address: "ts:src/a.ts#run", name: "run", kind: "function" },
      neighbours: ["ts:src/b.ts#a", "ts:src/c.ts#b"],
      root: "codegraph",
    });
    expect(p).toContain("`run` (function) at `ts:src/a.ts#run`");
    expect(p).toContain("ts:src/b.ts#a");
    expect(p).toContain("describe_node on the node above");
    expect(p).toContain("Repository: codegraph");
  });

  it("truncates a long neighbour list and reports the remainder", () => {
    const neighbours = Array.from({ length: 20 }, (_, i) => `ts:n${i}`);
    const p = buildAskPrompt({
      question: "q",
      focus: { address: "ts:x", name: "x", kind: "module" },
      neighbours,
    });
    expect(p).toContain("and 8 more");
    expect(p).not.toContain("ts:n12"); // 13th onward dropped (cap 12)
  });

  it("falls back to a general ask when the question is empty (never a dead end)", () => {
    const p = buildAskPrompt({ question: "" });
    expect(p).toContain("overview of how this codebase fits together");
    expect(p).toContain("graph_stats");
  });

  it("orients with graph_stats/find_nodes when there is no focus", () => {
    const p = buildAskPrompt({ question: "where do I start?" });
    expect(p).toContain("Begin with graph_stats and find_nodes");
    expect(p).not.toContain("describe_node on the node above");
  });
});
