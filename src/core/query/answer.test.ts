import { describe, it, expect } from "vitest";
import { CodeGraph } from "../graph/graph.js";
import type { GraphNode, GraphEdge } from "../graph/types.js";
import { answerQuestion, renderAnswer } from "./answer.js";

// A tiny app: app.ts#main calls auth.ts#login; login calls auth.ts#hashPassword.
function fixture(): CodeGraph {
  const g = new CodeGraph();
  const nodes: GraphNode[] = [
    { address: "ts:auth.ts", kind: "module", name: "auth.ts", location: { file: "auth.ts", line: 0, character: 0 } },
    { address: "ts:auth.ts#login", kind: "function", name: "login", signature: "login(u: string): User", location: { file: "auth.ts", line: 4, character: 0 } },
    { address: "ts:auth.ts#hashPassword", kind: "function", name: "hashPassword", location: { file: "auth.ts", line: 12, character: 0 } },
    { address: "ts:app.ts", kind: "module", name: "app.ts", location: { file: "app.ts", line: 0, character: 0 } },
    { address: "ts:app.ts#main", kind: "function", name: "main", location: { file: "app.ts", line: 1, character: 0 } },
  ];
  const edges: GraphEdge[] = [
    { from: "ts:auth.ts", to: "ts:auth.ts#login", type: "contains" },
    { from: "ts:auth.ts", to: "ts:auth.ts#hashPassword", type: "contains" },
    { from: "ts:app.ts", to: "ts:app.ts#main", type: "contains" },
    { from: "ts:app.ts#main", to: "ts:auth.ts#login", type: "calls" },
    { from: "ts:auth.ts#login", to: "ts:auth.ts#hashPassword", type: "calls" },
  ];
  for (const n of nodes) g.addNode(n);
  for (const e of edges) g.addEdge(e);
  return g;
}

describe("answerQuestion (FR-95)", () => {
  it("answers 'what calls login' with the real caller and callee, grounded", () => {
    const a = answerQuestion(fixture(), "what calls login");
    expect(a.found).toBe(true);
    expect(a.focus).toBe("callers");
    const login = a.matches.find((m) => m.node.name === "login");
    expect(login).toBeDefined();
    expect(login!.calledBy).toContain("ts:app.ts#main"); // real dependent
    expect(login!.calls).toContain("ts:auth.ts#hashPassword"); // real callee
    expect(login!.node.file).toBe("auth.ts");
  });

  it("detects a dependencies question", () => {
    expect(answerQuestion(fixture(), "what does login depend on").focus).toBe("dependencies");
  });

  it("honors a scope prefix (fn:) and reports the scope label", () => {
    const a = answerQuestion(fixture(), "fn:login");
    expect(a.scope).toBe("functions");
    expect(a.matches[0].node.name).toBe("login");
    expect(a.matches.every((m) => m.node.kind === "function")).toBe(true);
  });

  it("resolves a direct node address in the question", () => {
    const a = answerQuestion(fixture(), "describe ts:auth.ts#hashPassword");
    expect(a.found).toBe(true);
    expect(a.matches[0].node.address).toBe("ts:auth.ts#hashPassword");
  });

  it("is honest when nothing matches, and hands back an overview (never invents)", () => {
    const a = answerQuestion(fixture(), "where is frobnicateWidget");
    expect(a.found).toBe(false);
    expect(a.matches).toHaveLength(0);
    expect(a.note).toMatch(/No graph node matches/i);
    expect(a.overview).toBeDefined();
    expect(a.overview!.nodeCount).toBe(5);
  });

  it("gives a repo overview when no symbol is named", () => {
    const a = answerQuestion(fixture(), "give me an overview");
    expect(a.found).toBe(false);
    expect(a.focus).toBe("overview");
    expect(a.overview!.edgeCount).toBe(5);
  });

  it("renders grounded text with file:line citations and relationships", () => {
    const text = renderAnswer(answerQuestion(fixture(), "what calls login"));
    expect(text).toContain("auth.ts:4"); // file:line citation
    expect(text).toContain("called by:");
    expect(text).toContain("ts:app.ts#main");
  });
});
