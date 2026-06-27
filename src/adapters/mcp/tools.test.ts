import { describe, it, expect } from "vitest";
import { CodeGraph } from "../../core/graph/graph.js";
import { graphTools } from "./tools.js";
import { createGraphMcpServer } from "./server.js";
import { createNodeAnnotations } from "../../core/semantic/annotations.js";
import type { EnrichmentCache, NodeEnrichment } from "../../core/semantic/enrichment.js";
import type { GraphNode, GraphEdge } from "../../core/graph/types.js";

const node = (address: string, kind: GraphNode["kind"], name?: string): GraphNode => ({
  address,
  kind,
  name: name ?? (address.includes("#") ? (address.split(/[#.]/).pop() as string) : address),
  location: { file: address.replace(/^ts:/, "").split("#")[0], line: 0, character: 0 },
});

function fixture(): CodeGraph {
  const g = new CodeGraph();
  [
    node("ts:m.ts", "module", "m.ts"),
    node("ts:m.ts#foo", "function"),
    node("ts:m.ts#util", "function"),
  ].forEach((n) => g.addNode(n));
  const edge = (from: string, to: string, type: GraphEdge["type"]): GraphEdge => ({ from, to, type });
  [edge("ts:m.ts", "ts:m.ts#foo", "contains"), edge("ts:m.ts#foo", "ts:m.ts#util", "calls")].forEach((e) =>
    g.addEdge(e),
  );
  return g;
}

const toolMap = (g: CodeGraph) => new Map(graphTools(() => g).map((t) => [t.name, t]));
const parse = (text: string) => JSON.parse(text);

describe("MCP graph tools", () => {
  it("exposes the expected tool surface", () => {
    expect([...toolMap(fixture()).keys()].sort()).toEqual([
      "blast_radius",
      "dependencies",
      "describe_node",
      "find_nodes",
      "graph_stats",
      "list_orphans",
      "neighborhood",
    ]);
  });

  it("find_nodes returns matching nodes as JSON", () => {
    const r = toolMap(fixture()).get("find_nodes")!.handler({ query: "util" });
    expect(parse(r.content[0].text)[0].address).toBe("ts:m.ts#util");
  });

  it("blast_radius reports transitive dependents", () => {
    const r = toolMap(fixture()).get("blast_radius")!.handler({ address: "ts:m.ts#util" });
    expect(parse(r.content[0].text).count).toBe(1); // foo calls util
  });

  it("describe_node errors cleanly on an unknown address", () => {
    const r = toolMap(fixture()).get("describe_node")!.handler({ address: "ts:nope#ghost" });
    expect(r.isError).toBe(true);
  });

  it("reads the latest graph through the accessor (live updates)", () => {
    let g = new CodeGraph();
    const tools = new Map(graphTools(() => g).map((t) => [t.name, t]));
    expect(parse(tools.get("graph_stats")!.handler({}).content[0].text).nodeCount).toBe(0);
    g = fixture(); // swap in a populated graph after binding
    expect(parse(tools.get("graph_stats")!.handler({}).content[0].text).nodeCount).toBe(3);
  });

  it("createGraphMcpServer registers tools without throwing", () => {
    expect(createGraphMcpServer(() => fixture())).toBeTruthy();
  });
});

describe("MCP recent_changes tool", () => {
  const recentFixture = {
    ref: "HEAD",
    summary: { added: 1, removed: 0, changed: 0, moved: 0 },
    changes: [
      { address: "ts:m.ts#new", name: "new", kind: "function", change: "added", blastRadius: 0, dependents: [] },
    ],
  };

  it("appears only when a change provider is injected", () => {
    expect([...toolMap(fixture()).keys()]).not.toContain("recent_changes"); // graph-only mode
    const withProvider = graphTools(() => fixture(), async () => recentFixture).map((t) => t.name);
    expect(withProvider).toContain("recent_changes");
  });

  it("returns the provider's ranked feed and forwards the requested ref", async () => {
    let asked: string | undefined;
    const tools = new Map(
      graphTools(() => fixture(), async (ref) => {
        asked = ref;
        return recentFixture;
      }).map((t) => [t.name, t]),
    );
    const r = await tools.get("recent_changes")!.handler({ ref: "main" });
    expect(asked).toBe("main");
    expect(parse(r.content[0].text).summary.added).toBe(1);
  });

  it("defaults the baseline ref to HEAD", async () => {
    let asked: string | undefined;
    const tools = new Map(
      graphTools(() => fixture(), async (ref) => {
        asked = ref;
        return recentFixture;
      }).map((t) => [t.name, t]),
    );
    await tools.get("recent_changes")!.handler({});
    expect(asked).toBe("HEAD");
  });

  it("reports a clean error result when the provider throws (e.g. not a git repo)", async () => {
    const tools = new Map(
      graphTools(() => fixture(), async () => {
        throw new Error("codegraph: not a git repository.");
      }).map((t) => [t.name, t]),
    );
    const r = await tools.get("recent_changes")!.handler({});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("not a git repository");
  });
});

describe("MCP annotate_node tool (agent-driven enrichment)", () => {
  const memCache = (): EnrichmentCache => {
    const m = new Map<string, NodeEnrichment>();
    return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
  };
  const annTools = (g: CodeGraph) => {
    const annotations = createNodeAnnotations(() => g, memCache());
    return new Map(graphTools(() => g, undefined, annotations).map((t) => [t.name, t]));
  };

  it("appears only when an annotation store is injected", () => {
    expect([...toolMap(fixture()).keys()]).not.toContain("annotate_node");
    expect([...annTools(fixture()).keys()]).toContain("annotate_node");
  });

  it("stores an annotation that describe_node then surfaces as enrichment", async () => {
    const tools = annTools(fixture());
    const w = await tools.get("annotate_node")!.handler({
      address: "ts:m.ts#util",
      summary: "a small helper",
      intent: "shared logic",
      role: "utility",
    });
    expect(parse(w.content[0].text).annotated).toBe("ts:m.ts#util");
    const d = await tools.get("describe_node")!.handler({ address: "ts:m.ts#util" });
    expect(parse(d.content[0].text).enrichment).toEqual({
      summary: "a small helper",
      intent: "shared logic",
      role: "utility",
    });
  });

  it("defaults intent and role to empty strings when omitted", async () => {
    const tools = annTools(fixture());
    await tools.get("annotate_node")!.handler({ address: "ts:m.ts#util", summary: "only a summary" });
    const d = await tools.get("describe_node")!.handler({ address: "ts:m.ts#util" });
    expect(parse(d.content[0].text).enrichment).toEqual({ summary: "only a summary", intent: "", role: "" });
  });

  it("errors cleanly when annotating an unknown address", async () => {
    const r = await annTools(fixture()).get("annotate_node")!.handler({ address: "ts:nope#ghost", summary: "x" });
    expect(r.isError).toBe(true);
  });

  it("describe_node omits enrichment when none was stored", async () => {
    const d = await annTools(fixture()).get("describe_node")!.handler({ address: "ts:m.ts#foo" });
    expect(parse(d.content[0].text).enrichment).toBeUndefined();
  });
});
