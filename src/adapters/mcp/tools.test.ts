import { describe, it, expect } from "vitest";
import { CodeGraph } from "../../core/graph/graph.js";
import { graphTools } from "./tools.js";
import { createGraphMcpServer } from "./server.js";
import { createNodeAnnotations } from "../../core/semantic/annotations.js";
import type { EnrichmentCache, NodeEnrichment } from "../../core/semantic/enrichment.js";
import type { GraphNode, GraphEdge } from "../../core/graph/types.js";
import {
  emptyDiagramSet,
  upsertDiagram,
  removeDiagram,
  type DiagramStore,
} from "../../core/diagrams/diagram.js";
import { emptyDocSet, upsertDoc, removeDoc, type DocStore } from "../../core/docs/doc.js";
import {
  emptyOverlaySet,
  upsertOverlay,
  removeOverlay,
  type OverlayStore,
} from "../../core/overlays/overlay.js";
import type { PresentationCommand, PresentationCommandSink } from "../../core/presentation/command.js";

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
      "entry_points",
      "find_file",
      "find_nodes",
      "find_path",
      "find_symbol",
      "graph_stats",
      "list_orphans",
      "list_packages",
      "neighborhood",
      "query",
    ]);
  });

  it("query answers a natural-language question grounded in the graph (FR-95)", () => {
    const r = toolMap(fixture()).get("query")!.handler({ question: "what calls util" });
    const a = parse(r.content[0].text);
    expect(a.found).toBe(true);
    const util = a.matches.find((m: { node: { name: string } }) => m.node.name === "util");
    expect(util.calledBy).toContain("ts:m.ts#foo"); // real caller, not invented
    expect(util.node.file).toBe("m.ts");
  });

  it("query is honest (found:false + overview) when nothing matches", () => {
    const r = toolMap(fixture()).get("query")!.handler({ question: "where is nonexistentThing" });
    const a = parse(r.content[0].text);
    expect(a.found).toBe(false);
    expect(a.overview).toBeDefined();
  });

  it("find_symbol returns ranked symbols with their edges (FR-77)", () => {
    const r = toolMap(fixture()).get("find_symbol")!.handler({ query: "util" });
    const hits = parse(r.content[0].text);
    expect(hits[0].node.address).toBe("ts:m.ts#util");
    // foo calls util → util's dependents include foo (location + wiring in one call).
    expect(hits[0].dependents).toContain("ts:m.ts#foo");
  });

  it("find_file matches a module by path (FR-77)", () => {
    const r = toolMap(fixture()).get("find_file")!.handler({ query: "m.ts" });
    const hits = parse(r.content[0].text);
    expect(hits[0].address).toBe("ts:m.ts");
    expect(hits.every((h: { kind: string }) => h.kind === "module")).toBe(true);
  });

  it("find_path traces the directed dependency chain between two nodes", () => {
    const r = toolMap(fixture()).get("find_path")!.handler({ from: "ts:m.ts#foo", to: "ts:m.ts#util" });
    const path = parse(r.content[0].text);
    expect(path.found).toBe(true);
    expect(path.nodes).toEqual(["ts:m.ts#foo", "ts:m.ts#util"]);
    expect(path.steps[0].type).toBe("calls");
  });

  it("find_path reports found:false when no dependency route exists (contains excluded)", () => {
    // m.ts contains foo, foo calls util — but containment isn't a flow, so m.ts has no default route.
    const r = toolMap(fixture()).get("find_path")!.handler({ from: "ts:m.ts", to: "ts:m.ts#util" });
    expect(parse(r.content[0].text).found).toBe(false);
  });

  it("find_path can include contains via edgeTypes to walk structure", () => {
    const r = toolMap(fixture())
      .get("find_path")!
      .handler({ from: "ts:m.ts", to: "ts:m.ts#util", edgeTypes: ["contains", "calls"] });
    const path = parse(r.content[0].text);
    expect(path.found).toBe(true);
    expect(path.nodes).toEqual(["ts:m.ts", "ts:m.ts#foo", "ts:m.ts#util"]);
  });

  it("find_path errors cleanly on an unknown endpoint", () => {
    const r = toolMap(fixture()).get("find_path")!.handler({ from: "ts:m.ts#foo", to: "ts:nope#ghost" });
    expect(r.isError).toBe(true);
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
    const withProvider = graphTools(() => fixture(), { recentChanges: async () => recentFixture }).map((t) => t.name);
    expect(withProvider).toContain("recent_changes");
  });

  it("returns the provider's ranked feed and forwards the requested ref", async () => {
    let asked: string | undefined;
    const tools = new Map(
      graphTools(() => fixture(), {
        recentChanges: async (ref) => {
          asked = ref;
          return recentFixture;
        },
      }).map((t) => [t.name, t]),
    );
    const r = await tools.get("recent_changes")!.handler({ ref: "main" });
    expect(asked).toBe("main");
    expect(parse(r.content[0].text).summary.added).toBe(1);
  });

  it("defaults the baseline ref to HEAD", async () => {
    let asked: string | undefined;
    const tools = new Map(
      graphTools(() => fixture(), {
        recentChanges: async (ref) => {
          asked = ref;
          return recentFixture;
        },
      }).map((t) => [t.name, t]),
    );
    await tools.get("recent_changes")!.handler({});
    expect(asked).toBe("HEAD");
  });

  it("reports a clean error result when the provider throws (e.g. not a git repo)", async () => {
    const tools = new Map(
      graphTools(() => fixture(), {
        recentChanges: async () => {
          throw new Error("codegraph: not a git repository.");
        },
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
    return new Map(graphTools(() => g, { annotations }).map((t) => [t.name, t]));
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

describe("MCP diagram tools (agent-authored knowledge diagrams)", () => {
  const memStore = (): DiagramStore => {
    let set = emptyDiagramSet();
    return {
      all: () => Promise.resolve(set),
      save: (d) => {
        set = upsertDiagram(set, d);
        return Promise.resolve();
      },
      remove: (id) => {
        const had = set.diagrams.some((x) => x.id === id);
        set = removeDiagram(set, id);
        return Promise.resolve(had);
      },
    };
  };
  const dgTools = (g: CodeGraph, store: DiagramStore) =>
    new Map(graphTools(() => g, { diagrams: store }).map((t) => [t.name, t]));

  it("appears only when a diagram store is injected", () => {
    expect([...toolMap(fixture()).keys()]).not.toContain("save_diagram");
    const names = [...dgTools(fixture(), memStore()).keys()];
    expect(names).toEqual(expect.arrayContaining(["save_diagram", "list_diagrams", "delete_diagram"]));
  });

  it("save_diagram validates, stores, and returns the computed id", async () => {
    const store = memStore();
    const tools = dgTools(fixture(), store);
    const r = await tools.get("save_diagram")!.handler({
      title: "Login flow",
      category: "Workflow",
      mermaid: "```mermaid\nflowchart TD\n A-->B\n```",
    });
    expect(parse(r.content[0].text).saved).toBe("workflow/login-flow");
    const set = await store.all();
    expect(set.diagrams[0].mermaid).toBe("flowchart TD\n A-->B"); // fence stripped
  });

  it("list_diagrams returns what save_diagram stored", async () => {
    const store = memStore();
    const tools = dgTools(fixture(), store);
    await tools.get("save_diagram")!.handler({ title: "Arch", category: "architecture", mermaid: "graph LR\nA-->B" });
    const r = await tools.get("list_diagrams")!.handler({});
    expect(parse(r.content[0].text).diagrams).toHaveLength(1);
  });

  it("save_diagram errors cleanly on invalid input (empty mermaid)", async () => {
    const r = await dgTools(fixture(), memStore())
      .get("save_diagram")!
      .handler({ title: "X", category: "workflow", mermaid: "   " });
    expect(r.isError).toBe(true);
  });

  it("delete_diagram removes a saved diagram and errors on an unknown id", async () => {
    const store = memStore();
    const tools = dgTools(fixture(), store);
    await tools.get("save_diagram")!.handler({ title: "Login flow", category: "workflow", mermaid: "graph LR\nA-->B" });
    const ok = await tools.get("delete_diagram")!.handler({ id: "workflow/login-flow" });
    expect(parse(ok.content[0].text).deleted).toBe("workflow/login-flow");
    expect((await store.all()).diagrams).toHaveLength(0);
    const miss = await tools.get("delete_diagram")!.handler({ id: "workflow/login-flow" });
    expect(miss.isError).toBe(true);
  });
});

describe("MCP doc tools (agent-authored knowledge docs)", () => {
  const memStore = (): DocStore => {
    let set = emptyDocSet();
    return {
      all: () => Promise.resolve(set),
      save: (d) => {
        set = upsertDoc(set, d);
        return Promise.resolve();
      },
      remove: (id) => {
        const had = set.docs.some((x) => x.id === id);
        set = removeDoc(set, id);
        return Promise.resolve(had);
      },
    };
  };
  // Docs are injected as the 5th graphTools argument (after diagrams).
  const docTools = (g: CodeGraph, store: DocStore) =>
    new Map(graphTools(() => g, { docs: store }).map((t) => [t.name, t]));

  it("appears only when a doc store is injected", () => {
    expect([...toolMap(fixture()).keys()]).not.toContain("save_doc");
    const names = [...docTools(fixture(), memStore()).keys()];
    expect(names).toEqual(expect.arrayContaining(["save_doc", "list_docs", "delete_doc"]));
  });

  it("save_doc validates, stores, and returns the computed id", async () => {
    const store = memStore();
    const tools = docTools(fixture(), store);
    const r = await tools.get("save_doc")!.handler({
      title: "The graph pipeline",
      category: "Onboarding",
      markdown: "# Pipeline\n\nHow indexing works.",
    });
    expect(parse(r.content[0].text).saved).toBe("onboarding/the-graph-pipeline");
    const set = await store.all();
    expect(set.docs[0].markdown).toContain("How indexing works");
  });

  it("list_docs returns what save_doc stored", async () => {
    const store = memStore();
    const tools = docTools(fixture(), store);
    await tools.get("save_doc")!.handler({ title: "Arch", category: "architecture", markdown: "# Arch\n\nx." });
    const r = await tools.get("list_docs")!.handler({});
    expect(parse(r.content[0].text).docs).toHaveLength(1);
  });

  it("save_doc errors cleanly on invalid input (empty markdown)", async () => {
    const r = await docTools(fixture(), memStore())
      .get("save_doc")!
      .handler({ title: "X", category: "guide", markdown: "   " });
    expect(r.isError).toBe(true);
  });

  it("delete_doc removes a saved doc and errors on an unknown id", async () => {
    const store = memStore();
    const tools = docTools(fixture(), store);
    await tools.get("save_doc")!.handler({ title: "The graph pipeline", category: "onboarding", markdown: "# x\n\ny." });
    const ok = await tools.get("delete_doc")!.handler({ id: "onboarding/the-graph-pipeline" });
    expect(parse(ok.content[0].text).deleted).toBe("onboarding/the-graph-pipeline");
    expect((await store.all()).docs).toHaveLength(0);
    const miss = await tools.get("delete_doc")!.handler({ id: "onboarding/the-graph-pipeline" });
    expect(miss.isError).toBe(true);
  });
});

describe("MCP overlay tools (agent-authored knowledge overlays)", () => {
  const memStore = (): OverlayStore => {
    let set = emptyOverlaySet();
    return {
      all: () => Promise.resolve(set),
      save: (o) => {
        set = upsertOverlay(set, o);
        return Promise.resolve();
      },
      remove: (id) => {
        const had = set.overlays.some((x) => x.id === id);
        set = removeOverlay(set, id);
        return Promise.resolve(had);
      },
    };
  };
  // Overlays are injected as the 6th graphTools argument (after docs).
  const overlayTools = (g: CodeGraph, store: OverlayStore) =>
    new Map(
      graphTools(() => g, { overlays: store }).map((t) => [t.name, t]),
    );

  it("appears only when an overlay store is injected", () => {
    expect([...toolMap(fixture()).keys()]).not.toContain("pin_note");
    const names = [...overlayTools(fixture(), memStore()).keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        "pin_note",
        "ground_nodes",
        "annotate_edge",
        "mark_node",
        "group_nodes",
        "list_overlays",
        "remove_overlay",
      ]),
    );
  });

  it("pin_note validates, stores, and returns the computed id", async () => {
    const store = memStore();
    const tools = overlayTools(fixture(), store);
    const r = await tools.get("pin_note")!.handler({
      address: "ts:m.ts#foo",
      body: "the entry point; throws on a null arg.",
    });
    const out = parse(r.content[0].text);
    expect(out.kind).toBe("note");
    expect(typeof out.saved).toBe("string");
    const set = await store.all();
    expect(set.overlays).toHaveLength(1);
    expect(set.overlays[0]).toMatchObject({ kind: "note", body: "the entry point; throws on a null arg." });
  });

  it("ground_nodes bulk-grounds known nodes, reports unknowns, and tracks coverage", async () => {
    const store = memStore();
    const tools = overlayTools(fixture(), store);
    const r = await tools.get("ground_nodes")!.handler({
      groundings: [
        { address: "ts:m.ts#foo", body: "the entry point; throws on a null arg." },
        { address: "ts:m.ts#util", body: "string helper used across the module." },
        { address: "ts:ghost.ts#x", body: "not in the graph" },
      ],
    });
    const out = parse(r.content[0].text);
    expect(out.applied).toEqual(["ts:m.ts#foo", "ts:m.ts#util"]);
    expect(out.skipped).toEqual([{ address: "ts:ghost.ts#x", reason: "unknown-address" }]);
    expect(out.coverage).toEqual({ grounded: 2, total: 3, ungrounded: ["ts:m.ts"] });
    // Both notes landed in the same store pin_note writes to.
    const set = await store.all();
    expect(set.overlays).toHaveLength(2);
    expect(set.overlays.every((o) => o.kind === "note")).toBe(true);
  });

  it("annotate_edge pins a note on a directed edge", async () => {
    const store = memStore();
    const r = await overlayTools(fixture(), store).get("annotate_edge")!.handler({
      from: "ts:m.ts#foo",
      to: "ts:m.ts#util",
      type: "calls",
      body: "this call is the hot path.",
    });
    expect(parse(r.content[0].text).on).toBe("edge");
    const set = await store.all();
    expect(set.overlays[0]).toMatchObject({
      kind: "note",
      anchor: { on: "edge", from: "ts:m.ts#foo", to: "ts:m.ts#util", type: "calls" },
    });
  });

  it("mark_node stores a typed marker with severity", async () => {
    const store = memStore();
    const r = await overlayTools(fixture(), store).get("mark_node")!.handler({
      address: "ts:m.ts#foo",
      mark: "bug",
      severity: "error",
      label: "off-by-one",
    });
    expect(parse(r.content[0].text).mark).toBe("bug");
    const set = await store.all();
    expect(set.overlays[0]).toMatchObject({ kind: "mark", mark: "bug", severity: "error", label: "off-by-one" });
  });

  it("group_nodes stores a labelled member set", async () => {
    const store = memStore();
    const r = await overlayTools(fixture(), store).get("group_nodes")!.handler({
      label: "Core path",
      members: ["ts:m.ts#foo", "ts:m.ts#util"],
    });
    expect(parse(r.content[0].text).label).toBe("Core path");
    expect((await store.all()).overlays[0]).toMatchObject({
      kind: "group",
      members: ["ts:m.ts#foo", "ts:m.ts#util"],
    });
  });

  it("errors cleanly on invalid input (empty note body, unknown anchor)", async () => {
    const tools = overlayTools(fixture(), memStore());
    expect((await tools.get("pin_note")!.handler({ address: "ts:m.ts#foo", body: "  " })).isError).toBe(true);
    expect((await tools.get("group_nodes")!.handler({ label: "G", members: [] })).isError).toBe(true);
  });

  it("list_overlays returns what the write tools stored", async () => {
    const store = memStore();
    const tools = overlayTools(fixture(), store);
    await tools.get("pin_note")!.handler({ address: "ts:m.ts#foo", body: "a note." });
    await tools.get("mark_node")!.handler({ address: "ts:m.ts#util", mark: "todo" });
    const r = await tools.get("list_overlays")!.handler({});
    expect(parse(r.content[0].text).overlays).toHaveLength(2);
  });

  it("remove_overlay drops an overlay by id and errors on an unknown id", async () => {
    const store = memStore();
    const tools = overlayTools(fixture(), store);
    const saved = parse((await tools.get("pin_note")!.handler({ address: "ts:m.ts#foo", body: "x." })).content[0].text);
    const okRes = await tools.get("remove_overlay")!.handler({ id: saved.saved });
    expect(parse(okRes.content[0].text).deleted).toBe(saved.saved);
    expect((await store.all()).overlays).toHaveLength(0);
    expect((await tools.get("remove_overlay")!.handler({ id: saved.saved })).isError).toBe(true);
  });
});

describe("MCP codegraph_onboard tool (FR-42 agent onboarding playbook)", () => {
  const dgStore = (): DiagramStore => {
    let set = emptyDiagramSet();
    return {
      all: () => Promise.resolve(set),
      save: (d) => {
        set = upsertDiagram(set, d);
        return Promise.resolve();
      },
      remove: (id) => {
        const had = set.diagrams.some((x) => x.id === id);
        set = removeDiagram(set, id);
        return Promise.resolve(had);
      },
    };
  };
  const dcStore = (): DocStore => {
    let set = emptyDocSet();
    return {
      all: () => Promise.resolve(set),
      save: (d) => {
        set = upsertDoc(set, d);
        return Promise.resolve();
      },
      remove: (id) => {
        const had = set.docs.some((x) => x.id === id);
        set = removeDoc(set, id);
        return Promise.resolve(had);
      },
    };
  };
  const ovStore = (): OverlayStore => {
    let set = emptyOverlaySet();
    return {
      all: () => Promise.resolve(set),
      save: (o) => {
        set = upsertOverlay(set, o);
        return Promise.resolve();
      },
      remove: (id) => {
        const had = set.overlays.some((x) => x.id === id);
        set = removeOverlay(set, id);
        return Promise.resolve(had);
      },
    };
  };
  // The onboard tool needs all three knowledge stores (graphTools args 4/5/6).
  const onboardTools = (g: CodeGraph, dg: DiagramStore, dc: DocStore, ov: OverlayStore) =>
    new Map(graphTools(() => g, { diagrams: dg, docs: dc, overlays: ov }).map((t) => [t.name, t]));

  it("appears only when the diagram, doc, AND overlay stores are all injected", () => {
    // Just one store: the onboard tool stays hidden.
    expect([...new Map(graphTools(() => fixture(), { diagrams: dgStore() }).map((t) => [t.name, t])).keys()])
      .not.toContain("codegraph_onboard");
    expect([...onboardTools(fixture(), dgStore(), dcStore(), ovStore()).keys()]).toContain("codegraph_onboard");
  });

  it("returns a fresh-repo plan: index done, the authoring steps todo", async () => {
    const r = await onboardTools(fixture(), dgStore(), dcStore(), ovStore()).get("codegraph_onboard")!.handler({});
    const plan = parse(r.content[0].text);
    expect(plan.indexed).toBe(true);
    expect(plan.total).toBe(6);
    expect(plan.done).toBe(1);
    expect(plan.complete).toBe(false);
    expect(plan.summary).toContain("3 nodes");
  });

  it("is idempotent: an already-saved diagram flips its step to done on the next call", async () => {
    const dg = dgStore();
    const tools = onboardTools(fixture(), dg, dcStore(), ovStore());
    await tools.get("save_diagram")!.handler({ title: "Arch", category: "architecture", mermaid: "graph LR\nA-->B" });
    const plan = parse((await tools.get("codegraph_onboard")!.handler({})).content[0].text);
    const arch = plan.steps.find((s: { id: string }) => s.id === "architecture-diagram");
    expect(arch.status).toBe("done");
    expect(plan.done).toBe(2); // index + architecture
  });
});

describe("MCP driving tools (FR-39 live presentation commands)", () => {
  const memSink = (): { sink: PresentationCommandSink; emitted: PresentationCommand[] } => {
    const emitted: PresentationCommand[] = [];
    return { sink: { emit: (c) => void emitted.push(c) }, emitted };
  };
  // The command sink is injected as the 7th graphTools argument (after overlays).
  const driveTools = (g: CodeGraph, sink: PresentationCommandSink) =>
    new Map(
      graphTools(() => g, { commands: sink }).map((t) => [t.name, t]),
    );

  it("appears only when a command sink is injected", () => {
    expect([...toolMap(fixture()).keys()]).not.toContain("highlight_nodes");
    const names = [...driveTools(fixture(), memSink().sink).keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        "highlight_nodes",
        "highlight_path",
        "focus_camera",
        "set_projection",
        "open_panel",
        "toggle_affordance",
        "guided_tour",
        "replay_trace",
        "reveal_in_editor",
      ]),
    );
  });

  it("reveal_in_editor emits a reveal command carrying the address (FR-78)", async () => {
    const { sink, emitted } = memSink();
    const r = await driveTools(fixture(), sink).get("reveal_in_editor")!.handler({ address: "ts:m.ts#util" });
    expect(parse(r.content[0].text).presented).toEqual({ kind: "reveal", address: "ts:m.ts#util" });
    expect(emitted).toEqual([{ kind: "reveal", address: "ts:m.ts#util" }]);
  });

  it("highlight_nodes emits a validated command carrying the style", async () => {
    const { sink, emitted } = memSink();
    const r = await driveTools(fixture(), sink).get("highlight_nodes")!.handler({
      addresses: ["ts:m.ts#foo", "ts:m.ts#util"],
      style: "trace",
    });
    expect(parse(r.content[0].text).presented).toEqual({
      kind: "highlight_nodes",
      addresses: ["ts:m.ts#foo", "ts:m.ts#util"],
      style: "trace",
    });
    expect(emitted).toEqual([{ kind: "highlight_nodes", addresses: ["ts:m.ts#foo", "ts:m.ts#util"], style: "trace" }]);
  });

  it("omits an absent optional so the emitted command stays minimal", async () => {
    const { sink, emitted } = memSink();
    await driveTools(fixture(), sink).get("highlight_nodes")!.handler({ addresses: ["ts:m.ts#foo"] });
    // No style key at all (not style:undefined) — the codec drops the absent option.
    expect(emitted[0]).toEqual({ kind: "highlight_nodes", addresses: ["ts:m.ts#foo"] });
    expect("style" in emitted[0]).toBe(false);
  });

  it("focus_camera carries select:false through the codec", async () => {
    const { sink, emitted } = memSink();
    await driveTools(fixture(), sink).get("focus_camera")!.handler({ addresses: ["ts:m.ts#foo"], select: false });
    expect(emitted[0]).toEqual({ kind: "focus_camera", addresses: ["ts:m.ts#foo"], select: false });
  });

  it("set_projection / open_panel / toggle_affordance each emit their directive", async () => {
    const { sink, emitted } = memSink();
    const tools = driveTools(fixture(), sink);
    await tools.get("set_projection")!.handler({ projection: "dependency" });
    await tools.get("open_panel")!.handler({ panel: "diagrams", open: false });
    await tools.get("toggle_affordance")!.handler({ affordance: "orphans" });
    expect(emitted).toEqual([
      { kind: "set_projection", projection: "dependency" },
      { kind: "open_panel", panel: "diagrams", open: false },
      { kind: "toggle_affordance", affordance: "orphans" },
    ]);
  });

  it("guided_tour emits an ordered replay command carrying the dwell (FR-40)", async () => {
    const { sink, emitted } = memSink();
    const r = await driveTools(fixture(), sink).get("guided_tour")!.handler({
      addresses: ["ts:m.ts#foo", "ts:m.ts#util"],
      dwellMs: 600,
    });
    expect(parse(r.content[0].text).presented).toEqual({
      kind: "replay",
      addresses: ["ts:m.ts#foo", "ts:m.ts#util"],
      dwellMs: 600,
    });
    expect(emitted).toEqual([
      { kind: "replay", addresses: ["ts:m.ts#foo", "ts:m.ts#util"], dwellMs: 600 },
    ]);
  });

  it("guided_tour omits an absent dwell so the emitted command stays minimal", async () => {
    const { sink, emitted } = memSink();
    await driveTools(fixture(), sink).get("guided_tour")!.handler({ addresses: ["ts:m.ts#foo"] });
    expect(emitted[0]).toEqual({ kind: "replay", addresses: ["ts:m.ts#foo"] });
    expect("dwellMs" in emitted[0]).toBe(false);
  });

  it("highlight_path emits the from/to the board will resolve", async () => {
    const { sink, emitted } = memSink();
    await driveTools(fixture(), sink).get("highlight_path")!.handler({ from: "ts:m.ts#foo", to: "ts:m.ts#util" });
    expect(emitted[0]).toEqual({ kind: "highlight_path", from: "ts:m.ts#foo", to: "ts:m.ts#util" });
  });

  it("rejects an UNTRUSTED out-of-vocabulary directive without emitting", async () => {
    const { sink, emitted } = memSink();
    // zod guards the enum at the schema edge; the core codec is the backstop. Drive a
    // raw bad style straight through the handler to prove nothing is emitted.
    const r = await driveTools(fixture(), sink).get("highlight_nodes")!.handler({
      addresses: ["ts:m.ts#foo"],
      style: "neon",
    });
    expect(r.isError).toBe(true);
    expect(emitted).toHaveLength(0);
  });

  // A graph with distinct node start lines so the trace mapper has somewhere to land.
  const linedGraph = (): CodeGraph => {
    const g = new CodeGraph();
    const at = (address: string, line: number, kind: GraphNode["kind"] = "function"): GraphNode => ({
      address,
      kind,
      name: address.split(/[#.]/).pop() as string,
      location: { file: "m.ts", line, character: 0 },
    });
    [at("ts:m.ts", 0, "module"), at("ts:m.ts#foo", 10), at("ts:m.ts#util", 20)].forEach((n) => g.addNode(n));
    return g;
  };

  it("replay_trace maps a stack trace to an ordered replay tour (FR-41)", async () => {
    const { sink, emitted } = memSink();
    const trace = ["Error: boom", "    at util (/x/m.ts:22:1)", "    at foo (/x/m.ts:12:1)"].join("\n");
    const r = await driveTools(linedGraph(), sink).get("replay_trace")!.handler({ trace, dwellMs: 500 });
    expect(parse(r.content[0].text).presented).toEqual({
      kind: "replay",
      addresses: ["ts:m.ts#util", "ts:m.ts#foo"],
      dwellMs: 500,
    });
    expect(emitted).toEqual([{ kind: "replay", addresses: ["ts:m.ts#util", "ts:m.ts#foo"], dwellMs: 500 }]);
  });

  it("replay_trace fails without emitting when no frame maps to a node (graceful)", async () => {
    const { sink, emitted } = memSink();
    const r = await driveTools(linedGraph(), sink)
      .get("replay_trace")!
      .handler({ trace: "    at x (/vendor/dep/lib.js:3:1)" });
    expect(r.isError).toBe(true);
    expect(emitted).toHaveLength(0);
  });
});
