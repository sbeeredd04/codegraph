import { describe, it, expect } from "vitest";
import { CodeGraph } from "../graph/graph.js";
import type { GraphNode } from "../graph/types.js";
import type { EnrichmentCache, NodeEnrichment } from "./enrichment.js";
import { createNodeAnnotations } from "./annotations.js";

const E: NodeEnrichment = { summary: "Authenticates a user", intent: "gate access", role: "orchestrator" };

const memCache = (): EnrichmentCache => {
  const m = new Map<string, NodeEnrichment>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
};

const login = (address: string, signature = "login(u,p)"): GraphNode => ({
  address,
  kind: "function",
  name: "login",
  location: { file: address.split("#")[0].replace(/^\w+:/, ""), line: 0, character: 0 },
  signature,
});

/** A graph where `login` (at the given address/signature) calls hashPassword. */
function graphOf(address: string, signature?: string): CodeGraph {
  const g = new CodeGraph();
  g.addNode(login(address, signature));
  g.addNode({
    address: "ts:src/hash.ts#hashPassword",
    kind: "function",
    name: "hashPassword",
    location: { file: "src/hash.ts", line: 0, character: 0 },
  });
  g.addEdge({ from: address, to: "ts:src/hash.ts#hashPassword", type: "calls" });
  return g;
}

describe("createNodeAnnotations", () => {
  it("returns false and stores nothing for an unknown address", async () => {
    const ann = createNodeAnnotations(() => graphOf("ts:src/auth.ts#login"), memCache());
    expect(await ann.set("ts:nope#ghost", E)).toBe(false);
    expect(await ann.get("ts:nope#ghost")).toBeUndefined();
  });

  it("round-trips an enrichment for a known node", async () => {
    const ann = createNodeAnnotations(() => graphOf("ts:src/auth.ts#login"), memCache());
    expect(await ann.set("ts:src/auth.ts#login", E)).toBe(true);
    expect(await ann.get("ts:src/auth.ts#login")).toEqual(E);
  });

  it("returns undefined when nothing is stored for a known node", async () => {
    const ann = createNodeAnnotations(() => graphOf("ts:src/auth.ts#login"), memCache());
    expect(await ann.get("ts:src/auth.ts#login")).toBeUndefined();
  });

  it("keeps the annotation when the node only moves (content hash survives a rename — no re-spend)", async () => {
    const cache = memCache();
    let graph = graphOf("ts:src/auth.ts#login");
    const ann = createNodeAnnotations(() => graph, cache);
    await ann.set("ts:src/auth.ts#login", E);
    // login moves to another file, identical signature + calls.
    graph = graphOf("ts:src/auth/index.ts#login");
    expect(await ann.get("ts:src/auth/index.ts#login")).toEqual(E);
  });

  it("drops the annotation when the node's signature changes (stale, self-correcting)", async () => {
    const cache = memCache();
    let graph = graphOf("ts:src/auth.ts#login");
    const ann = createNodeAnnotations(() => graph, cache);
    await ann.set("ts:src/auth.ts#login", E);
    // login's signature changes — its meaning may have shifted, so the old enrichment no longer applies.
    graph = graphOf("ts:src/auth.ts#login", "login(token: string)");
    expect(await ann.get("ts:src/auth.ts#login")).toBeUndefined();
  });
});
