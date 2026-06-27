import { describe, it, expect } from "vitest";
import { CodeGraph } from "../graph/graph.js";
import type { GraphNode, NodeKind } from "../graph/types.js";
import { buildEnrichmentContext } from "./context.js";

const node = (address: string, name: string, kind: NodeKind = "function"): GraphNode => ({
  address,
  kind,
  name,
  location: { file: address.split("#")[0].replace(/^\w+:/, ""), line: 0, character: 0 },
  signature: `${name}()`,
});

function graphWith(): CodeGraph {
  const g = new CodeGraph();
  g.addNode(node("ts:src/auth.ts", "auth.ts", "module"));
  g.addNode(node("ts:src/auth.ts#login", "login"));
  g.addNode(node("ts:src/hash.ts#hashPassword", "hashPassword"));
  g.addNode(node("ts:src/session.ts#createSession", "createSession"));
  g.addNode(node("ts:src/api.ts#handleRequest", "handleRequest"));
  // login calls hashPassword + createSession; handleRequest calls login.
  g.addEdge({ from: "ts:src/auth.ts#login", to: "ts:src/hash.ts#hashPassword", type: "calls" });
  g.addEdge({ from: "ts:src/auth.ts#login", to: "ts:src/session.ts#createSession", type: "calls" });
  g.addEdge({ from: "ts:src/api.ts#handleRequest", to: "ts:src/auth.ts#login", type: "calls" });
  // structural containment must NOT count as a call.
  g.addEdge({ from: "ts:src/auth.ts", to: "ts:src/auth.ts#login", type: "contains" });
  return g;
}

describe("buildEnrichmentContext", () => {
  it("returns undefined for an unknown address", () => {
    expect(buildEnrichmentContext(graphWith(), "ts:nope#missing")).toBeUndefined();
  });

  it("carries the node itself", () => {
    const ctx = buildEnrichmentContext(graphWith(), "ts:src/auth.ts#login");
    expect(ctx?.node.name).toBe("login");
  });

  it("collects outbound dependency targets as calls (by name)", () => {
    const ctx = buildEnrichmentContext(graphWith(), "ts:src/auth.ts#login");
    expect([...(ctx?.calls ?? [])].sort()).toEqual(["createSession", "hashPassword"]);
  });

  it("collects inbound dependency sources as calledBy (by name)", () => {
    const ctx = buildEnrichmentContext(graphWith(), "ts:src/auth.ts#login");
    expect(ctx?.calledBy).toEqual(["handleRequest"]);
  });

  it("excludes structural containment edges from calls", () => {
    // the module contains login, but that is not something the module 'calls'.
    const ctx = buildEnrichmentContext(graphWith(), "ts:src/auth.ts");
    expect(ctx?.calls).toEqual([]);
  });

  it("falls back to a short address when an edge target is not a known node", () => {
    const g = new CodeGraph();
    g.addNode(node("ts:src/a.ts#caller", "caller"));
    g.addEdge({ from: "ts:src/a.ts#caller", to: "ts:src/ext.ts#ghost", type: "calls" });
    const ctx = buildEnrichmentContext(g, "ts:src/a.ts#caller");
    expect(ctx?.calls).toEqual(["ghost"]);
  });

  it("deduplicates repeated neighbour names", () => {
    const g = new CodeGraph();
    g.addNode(node("ts:src/a.ts#caller", "caller"));
    g.addNode(node("ts:src/b.ts#target", "target"));
    g.addEdge({ from: "ts:src/a.ts#caller", to: "ts:src/b.ts#target", type: "calls" });
    g.addEdge({ from: "ts:src/a.ts#caller", to: "ts:src/b.ts#target", type: "depends-on" });
    const ctx = buildEnrichmentContext(g, "ts:src/a.ts#caller");
    expect(ctx?.calls).toEqual(["target"]);
  });
});
