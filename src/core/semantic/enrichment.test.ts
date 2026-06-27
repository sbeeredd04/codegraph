import { describe, it, expect, vi } from "vitest";
import type { GraphNode } from "../graph/types.js";
import type { ModelProvider } from "../ports.js";
import {
  type EnrichmentContext,
  type EnrichmentCache,
  type NodeEnrichment,
  buildEnrichmentPrompt,
  parseEnrichment,
  enrichmentKey,
  enrichNode,
} from "./enrichment.js";

const node = (over: Partial<GraphNode> = {}): GraphNode => ({
  address: "ts:src/auth.ts#login",
  kind: "function",
  name: "login",
  location: { file: "src/auth.ts", line: 10, character: 0 },
  signature: "login(user: string, pass: string): Promise<Session>",
  ...over,
});

const ctx = (over: Partial<EnrichmentContext> = {}): EnrichmentContext => ({
  node: node(),
  calls: ["hashPassword", "createSession"],
  calledBy: ["handleRequest"],
  ...over,
});

describe("enrichmentKey (content hash — cache by meaning, not position)", () => {
  it("is stable for identical inputs", () => {
    expect(enrichmentKey(ctx())).toBe(enrichmentKey(ctx()));
  });

  it("is insensitive to call order (set, not sequence)", () => {
    const a = enrichmentKey(ctx({ calls: ["a", "b"] }));
    const b = enrichmentKey(ctx({ calls: ["b", "a"] }));
    expect(a).toBe(b);
  });

  it("ignores location — a node that only moved keeps its cache (no re-spend)", () => {
    const moved = ctx({ node: node({ location: { file: "src/new.ts", line: 999, character: 4 } }) });
    expect(enrichmentKey(moved)).toBe(enrichmentKey(ctx()));
  });

  it("ignores callers — a new dependent does not bust a node's own enrichment", () => {
    expect(enrichmentKey(ctx({ calledBy: ["x", "y", "z"] }))).toBe(enrichmentKey(ctx()));
  });

  it("changes when the signature changes", () => {
    const sig = ctx({ node: node({ signature: "login(token: string): Session" }) });
    expect(enrichmentKey(sig)).not.toBe(enrichmentKey(ctx()));
  });

  it("changes when the outbound calls change (its behaviour shifted)", () => {
    expect(enrichmentKey(ctx({ calls: ["hashPassword"] }))).not.toBe(enrichmentKey(ctx()));
  });
});

describe("buildEnrichmentPrompt", () => {
  it("includes the node name, kind, signature and its call targets", () => {
    const p = buildEnrichmentPrompt(ctx());
    expect(p).toContain("login");
    expect(p).toContain("function");
    expect(p).toContain("login(user: string, pass: string): Promise<Session>");
    expect(p).toContain("hashPassword");
    expect(p).toContain("handleRequest");
  });

  it("asks for a strict JSON object with summary, intent and role", () => {
    const p = buildEnrichmentPrompt(ctx());
    expect(p).toMatch(/json/i);
    expect(p).toContain("summary");
    expect(p).toContain("intent");
    expect(p).toContain("role");
  });
});

describe("parseEnrichment (tolerant of model formatting)", () => {
  it("parses a clean JSON object", () => {
    const e = parseEnrichment('{"summary":"Authenticates a user","intent":"gate access","role":"orchestrator"}');
    expect(e).toEqual({ summary: "Authenticates a user", intent: "gate access", role: "orchestrator" });
  });

  it("strips a ```json code fence", () => {
    const raw = '```json\n{"summary":"s","intent":"i","role":"r"}\n```';
    expect(parseEnrichment(raw)).toEqual({ summary: "s", intent: "i", role: "r" });
  });

  it("extracts the object from surrounding prose", () => {
    const raw = 'Sure! Here is the result:\n{"summary":"s","intent":"i","role":"r"}\nHope that helps.';
    expect(parseEnrichment(raw)).toEqual({ summary: "s", intent: "i", role: "r" });
  });

  it("falls back to empty fields on unparseable output", () => {
    expect(parseEnrichment("not json at all")).toEqual({ summary: "", intent: "", role: "" });
  });

  it("coerces missing fields to empty strings", () => {
    expect(parseEnrichment('{"summary":"only this"}')).toEqual({ summary: "only this", intent: "", role: "" });
  });
});

describe("enrichNode (cache-by-hash orchestration — no re-spend)", () => {
  const enrichment: NodeEnrichment = { summary: "s", intent: "i", role: "r" };

  const fakeCache = (seed: Record<string, NodeEnrichment> = {}): EnrichmentCache => {
    const store = new Map(Object.entries(seed));
    return {
      get: (k) => store.get(k),
      set: (k, v) => {
        store.set(k, v);
      },
    };
  };

  it("calls the provider on a cache miss, stores the result, and returns it", async () => {
    const provider: ModelProvider = {
      id: "fake",
      describe: vi.fn(async () => '{"summary":"s","intent":"i","role":"r"}'),
    };
    const cache = fakeCache();
    const out = await enrichNode(ctx(), provider, cache);
    expect(out).toEqual(enrichment);
    expect(provider.describe).toHaveBeenCalledOnce();
    // a second call for the same node now hits the cache — provider not called again
    await enrichNode(ctx(), provider, cache);
    expect(provider.describe).toHaveBeenCalledOnce();
  });

  it("returns the cached enrichment without calling the provider", async () => {
    const provider: ModelProvider = { id: "fake", describe: vi.fn(async () => "{}") };
    const cache = fakeCache({ [enrichmentKey(ctx())]: enrichment });
    const out = await enrichNode(ctx(), provider, cache);
    expect(out).toEqual(enrichment);
    expect(provider.describe).not.toHaveBeenCalled();
  });
});
