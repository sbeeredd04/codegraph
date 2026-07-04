import { z } from "zod";
import type { CodeGraph } from "../../core/graph/graph.js";
import type { NodeKind } from "../../core/graph/types.js";
import type { RankedChange } from "../../core/graph/change-feed.js";
import type { NodeAnnotations } from "../../core/semantic/annotations.js";
import type { NodeEnrichment } from "../../core/semantic/enrichment.js";
import {
  validateDiagram,
  KNOWN_DIAGRAM_CATEGORIES,
  type DiagramStore,
} from "../../core/diagrams/diagram.js";
import { validateDoc, KNOWN_DOC_CATEGORIES, type DocStore } from "../../core/docs/doc.js";
import { type OverlayStore } from "../../core/overlays/overlay.js";
import { overlayWriteTools } from "./overlay-tools.js";
import { ok, fail, ADDRESS, type GraphTool, type McpToolResult } from "./mcp-tool.js";
import {
  validatePresentationCommand,
  HIGHLIGHT_STYLES,
  PANEL_KINDS,
  AFFORDANCE_KINDS,
  PROJECTION_KINDS,
  type PresentationCommandSink,
} from "../../core/presentation/command.js";
import { traceToAddresses } from "../../core/presentation/log-trace.js";
import { buildOnboardPlaybook } from "../../core/onboard/playbook.js";
import {
  findNodes,
  findSymbols,
  findFiles,
  listPackages,
  entryPoints,
  describeNode,
  blastRadius,
  dependencies,
  graphStats,
  neighborhood,
} from "../../core/graph/query.js";
import { answerQuestion } from "../../core/query/answer.js";
import { findPath } from "../../core/graph/path.js";
import type { EdgeType } from "../../core/graph/types.js";

// MCP tool surface (Epic 3 / FR-13): the read-only questions the user's AI
// agent asks of the live graph — the same map the human reads. Each tool is a
// thin wrapper over the pure query layer, kept here (not in server.ts) so the
// handlers are testable without standing up the SDK transport.

// The tool-result shape + descriptor live in ./mcp-tool (shared with overlay-tools);
// re-exported here so existing importers of these types from ./tools keep working.
export type { McpToolResult, GraphTool } from "./mcp-tool.js";

/** A ranked "what just changed" feed: the diff of the working tree against a git ref. */
export interface RecentChanges {
  readonly ref: string;
  readonly summary: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly moved: number;
  };
  readonly changes: readonly RankedChange[];
}

/**
 * Supplies the live change feed. Injected by the launchable server (it does the
 * I/O: re-scan the working tree, build the git baseline, diff and rank) so the
 * pure tool layer here stays I/O-free and testable (AD-1).
 */
export type RecentChangesProvider = (ref: string) => Promise<RecentChanges>;

/**
 * Optional capabilities injected into {@link graphTools}. Every field gates a
 * group of write/drive tools that only appear when the host wires the backing
 * store: `recentChanges` → the live change feed, `annotations` → annotate_node,
 * `diagrams`/`docs`/`overlays` → the knowledge write tools (and, when all three
 * are present, codegraph_onboard), `commands` → the FR-39 driving tools. Passed
 * as one bag rather than a positional tail so adding a capability never reorders
 * existing call sites (and callers needing only the last one skip the noise).
 */
export interface GraphToolDeps {
  readonly recentChanges?: RecentChangesProvider;
  readonly annotations?: NodeAnnotations;
  readonly diagrams?: DiagramStore;
  readonly docs?: DocStore;
  readonly overlays?: OverlayStore;
  readonly commands?: PresentationCommandSink;
}

const KIND = z.enum(["module", "class", "function", "method", "workflow"]);
const EDGE_TYPE = z.enum(["calls", "depends-on", "contains", "hands-off-to"]);
// Presentation-command vocabularies (FR-39). The core codec is the source of
// truth (validatePresentationCommand re-checks every emit); these only sharpen
// the MCP input schema. Cast for the same readonly-tuple reason as MARK_KIND.
const HIGHLIGHT_STYLE = z.enum(HIGHLIGHT_STYLES as unknown as [string, ...string[]]);
const PANEL = z.enum(PANEL_KINDS as unknown as [string, ...string[]]);
const AFFORDANCE = z.enum(AFFORDANCE_KINDS as unknown as [string, ...string[]]);
const PROJECTION = z.enum(PROJECTION_KINDS as unknown as [string, ...string[]]);

/**
 * Build the graph tools bound to a graph accessor (re-read each call so live
 * updates show). The read-only query tools are always present; the optional
 * write/drive tools appear only when their backing capability is supplied in
 * {@link GraphToolDeps} (omitted in graph-only contexts — e.g. no git baseline
 * for `recent_changes`, no store for the knowledge write tools).
 */
export function graphTools(getGraph: () => CodeGraph, deps: GraphToolDeps = {}): GraphTool[] {
  const { recentChanges, annotations, diagrams, docs, overlays, commands } = deps;
  const tools: GraphTool[] = [
    {
      name: "query",
      title: "Ask the graph",
      description:
        "Ask a natural-language question about THIS codebase (\"what calls login\", " +
        "\"what does the auth module depend on\", \"where is X defined\") and get a grounded " +
        "answer in one call: the matching graph nodes with their real call / depends-on / " +
        "contains edges, their callers, and file:line citations. Answered ONLY from the " +
        "graph — never an invented edge or caller; if the graph lacks it, the answer says " +
        "so. Prefer this over grep, and over chaining find_symbol + describe_node, for any " +
        "structural question.",
      inputSchema: {
        question: z.string().min(1).describe("A natural-language question about the codebase."),
        limit: z.number().int().positive().max(50).optional().describe("Max matched nodes (default 8)."),
      },
      handler: (args) =>
        ok(answerQuestion(getGraph(), String(args.question), { limit: args.limit as number | undefined })),
    },
    {
      name: "find_nodes",
      title: "Find nodes",
      description:
        "Fuzzy-search the code graph for nodes by name (fzf-style ranking, best first; " +
        "falls back to the address). Optionally filter by kind. Returns address, kind, " +
        "name, and file:line — prefer this over grep to locate a symbol.",
      inputSchema: {
        query: z.string().describe("Fuzzy query matched on the node name (then address)."),
        kind: KIND.optional().describe("Restrict to one node kind."),
        limit: z.number().int().positive().max(500).optional().describe("Max results (default 50)."),
      },
      handler: (args) =>
        ok(
          findNodes(getGraph(), String(args.query ?? ""), {
            kind: args.kind as NodeKind | undefined,
            limit: args.limit as number | undefined,
          }),
        ),
    },
    {
      name: "find_symbol",
      title: "Find symbol (with edges)",
      description:
        "Fuzzy-search functions, methods and classes and return each match WITH its " +
        "immediate wiring — outbound edges grouped by relation (calls, depends-on, …) " +
        "and its direct dependents (callers/importers). One call gives the exact " +
        "location AND the call graph around it — a superset of what grep can find.",
      inputSchema: {
        query: z.string().describe("Fuzzy query matched on the symbol name."),
        limit: z.number().int().positive().max(50).optional().describe("Max symbols (default 10)."),
      },
      handler: (args) =>
        ok(findSymbols(getGraph(), String(args.query ?? ""), { limit: args.limit as number | undefined })),
    },
    {
      name: "find_file",
      title: "Find file",
      description:
        "Fuzzy-search module/file nodes by their PATH — 'client/index' finds " +
        "packages/client/src/index.ts. Returns address, name and file:line.",
      inputSchema: {
        query: z.string().describe("Fuzzy query matched on the file path."),
        limit: z.number().int().positive().max(200).optional().describe("Max results (default 50)."),
      },
      handler: (args) =>
        ok(findFiles(getGraph(), String(args.query ?? ""), { limit: args.limit as number | undefined })),
    },
    {
      name: "list_packages",
      title: "List packages",
      description:
        "List the monorepo packages / workspaces the codebase partitions into " +
        "(id, label, node count), most populated first — the subsystem map to " +
        "orient before drilling in.",
      inputSchema: {},
      handler: () => ok(listPackages(getGraph())),
    },
    {
      name: "entry_points",
      title: "Entry points",
      description:
        "Where does execution start? Returns the graph's likely entry points " +
        "(main.*, CLIs, web-app modules, dependency roots, a main() function), " +
        "ranked with a reason — the best place to begin reading the codebase.",
      inputSchema: {
        limit: z.number().int().positive().max(100).optional().describe("Max entry points (default 20)."),
      },
      handler: (args) => ok(entryPoints(getGraph(), (args.limit as number | undefined) ?? 20)),
    },
    {
      name: "describe_node",
      title: "Describe node",
      description:
        "Describe one node: its kind and location, its outbound edges grouped by relation " +
        "(calls, depends-on, contains, hands-off-to), and its direct dependents.",
      inputSchema: { address: ADDRESS },
      handler: (args) => {
        const address = String(args.address);
        const detail = describeNode(getGraph(), address);
        if (!detail) return fail(`codegraph: no node at address "${address}".`);
        // When annotations are available, fold in the node's stored enrichment
        // (the agent's own summary/intent/role), if any. Stays sync otherwise.
        if (!annotations) return ok(detail);
        return annotations
          .get(address)
          .then((enrichment) => ok(enrichment ? { ...detail, enrichment } : detail));
      },
    },
    {
      name: "blast_radius",
      title: "Blast radius",
      description:
        "Compute the blast radius of a node: every node that transitively depends on it " +
        "(its impact set if it changes), following dependency edges only.",
      inputSchema: { address: ADDRESS },
      handler: (args) => ok(blastRadius(getGraph(), String(args.address))),
    },
    {
      name: "dependencies",
      title: "Dependencies",
      description:
        "List everything a node transitively depends on (its forward closure), " +
        "following dependency edges only.",
      inputSchema: { address: ADDRESS },
      handler: (args) => ok(dependencies(getGraph(), String(args.address))),
    },
    {
      name: "find_path",
      title: "Find path",
      description:
        "Trace how one node reaches another: the shortest directed chain of dependency edges " +
        "(calls, depends-on, hands-off-to) from `from` to `to`. Use it to follow a request or " +
        "data flow end to end — e.g. from an entry point to a database write — then turn the chain " +
        "into a sequence or flow diagram. Returns the ordered steps (each with its edge type) and " +
        "the node path, or found:false when no such route exists. Pass edgeTypes to trace other " +
        "relations (e.g. include 'contains' to walk structure).",
      inputSchema: {
        from: z.string().min(1).describe("Start node address, e.g. ts:src/api.ts#handleRequest"),
        to: z.string().min(1).describe("Target node address to reach, e.g. ts:src/db.ts#write"),
        edgeTypes: z
          .array(EDGE_TYPE)
          .optional()
          .describe("Edge types to traverse (default: calls, depends-on, hands-off-to)."),
      },
      handler: (args) => {
        const graph = getGraph();
        const from = String(args.from);
        const to = String(args.to);
        if (!graph.getNode(from)) return fail(`codegraph: no node at address "${from}".`);
        if (!graph.getNode(to)) return fail(`codegraph: no node at address "${to}".`);
        const edgeTypes = Array.isArray(args.edgeTypes)
          ? new Set<EdgeType>(args.edgeTypes as EdgeType[])
          : undefined;
        return ok(findPath(graph, from, to, { edgeTypes }));
      },
    },
    {
      name: "neighborhood",
      title: "Neighborhood",
      description:
        "The local map around a node: every node within N hops in either direction " +
        "(callers, callees, container, contents) plus the edges among them. Use to " +
        "zoom in on a region before reasoning about it.",
      inputSchema: {
        address: ADDRESS,
        radius: z.number().int().min(0).max(5).optional().describe("Hops outward (default 1)."),
      },
      handler: (args) => {
        const hood = neighborhood(getGraph(), String(args.address), args.radius as number | undefined);
        return hood ? ok(hood) : fail(`codegraph: no node at address "${String(args.address)}".`);
      },
    },
    {
      name: "list_orphans",
      title: "List orphans",
      description: "List nodes with no inbound edge — dead-code candidates the agent may prune.",
      inputSchema: {},
      handler: () => ok(getGraph().orphans()),
    },
    {
      name: "graph_stats",
      title: "Graph stats",
      description: "Summarize the graph: total nodes, total edges, and a breakdown by node kind.",
      inputSchema: {},
      handler: () => ok(graphStats(getGraph())),
    },
  ];

  if (recentChanges) {
    tools.push({
      name: "recent_changes",
      title: "Recent changes",
      description:
        "What changed in the working tree versus a git ref (default HEAD): the ranked " +
        "change feed — added, changed, removed and moved nodes ordered by blast radius. " +
        "Use this to see what you (or another agent) just changed and what it impacts.",
      inputSchema: {
        ref: z.string().min(1).optional().describe("Git ref to diff against (default HEAD)."),
      },
      handler: async (args) => {
        try {
          const ref = args.ref ? String(args.ref) : "HEAD";
          return ok(await recentChanges(ref));
        } catch (e) {
          return fail(e instanceof Error ? e.message : "codegraph: could not compute recent changes.");
        }
      },
    });
  }

  if (annotations) {
    tools.push({
      name: "annotate_node",
      title: "Annotate node",
      description:
        "Record your understanding of a node onto the graph: a one-line summary of what it does, " +
        "why it exists (intent), and its architectural role. The human board and describe_node then " +
        "surface it. It's cached by the node's content hash, so it survives a move/rename but is " +
        "dropped once the node's signature or call set changes — annotate again when that happens. " +
        "This writes graph metadata only; it never touches source files.",
      inputSchema: {
        address: ADDRESS,
        summary: z.string().min(1).describe("One sentence: what this node does."),
        intent: z.string().optional().describe("Why it exists — the purpose it serves in the system."),
        role: z.string().optional().describe("Its architectural role, e.g. port, adapter, orchestrator."),
      },
      handler: async (args) => {
        const address = String(args.address);
        const enrichment: NodeEnrichment = {
          summary: String(args.summary ?? ""),
          intent: args.intent ? String(args.intent) : "",
          role: args.role ? String(args.role) : "",
        };
        const stored = await annotations.set(address, enrichment);
        return stored
          ? ok({ annotated: address, enrichment })
          : fail(`codegraph: no node at address "${address}".`);
      },
    });
  }

  if (diagrams) {
    tools.push(
      {
        name: "save_diagram",
        title: "Save diagram",
        description:
          "Save a Mermaid diagram you synthesized from the graph onto the repo's knowledge layer. " +
          "Explore first (find_nodes, neighborhood, dependencies, blast_radius, graph_stats), then " +
          "capture a higher-level view the structure graph can't show on its own: a user workflow end " +
          "to end, the system architecture, a request's sequence, a data flow. Prefer SEVERAL focused " +
          "diagrams over one giant one, each categorized — you choose the categories (suggested: " +
          `${KNOWN_DIAGRAM_CATEGORIES.join(", ")}). Re-saving the same title+category updates that ` +
          "diagram in place. The human board and the standalone viewer render these. Writes graph " +
          "metadata only; it never touches source files.",
        inputSchema: {
          title: z.string().min(1).describe("Short, specific title, e.g. 'Login request sequence'."),
          category: z
            .string()
            .min(1)
            .describe(`Category — you decide (suggested: ${KNOWN_DIAGRAM_CATEGORIES.join(", ")}).`),
          mermaid: z
            .string()
            .min(1)
            .describe("Mermaid source (fenced or raw), e.g. a flowchart, sequenceDiagram, or classDiagram."),
          description: z.string().optional().describe("One or two lines on what this diagram shows."),
          related: z
            .array(z.string())
            .optional()
            .describe("Graph node addresses this diagram is about, to link it back to the graph."),
        },
        handler: async (args) => {
          const result = validateDiagram({
            title: args.title,
            category: args.category,
            mermaid: args.mermaid,
            description: args.description,
            related: args.related,
            updatedAt: new Date().toISOString(),
          });
          if (!result.ok) return fail(`codegraph: ${result.error}`);
          await diagrams.save(result.diagram);
          return ok({
            saved: result.diagram.id,
            title: result.diagram.title,
            category: result.diagram.category,
          });
        },
      },
      {
        name: "list_diagrams",
        title: "List diagrams",
        description:
          "List the Mermaid diagrams already saved for this repo (id, title, category, description, and " +
          "source). Review these before adding more so you refine and fill gaps rather than duplicate.",
        inputSchema: {},
        handler: async () => ok(await diagrams.all()),
      },
      {
        name: "delete_diagram",
        title: "Delete diagram",
        description: "Delete a saved diagram by its id (as returned by save_diagram or list_diagrams).",
        inputSchema: {
          id: z.string().min(1).describe("The diagram id, e.g. 'workflow/login-flow'."),
        },
        handler: async (args) => {
          const id = String(args.id);
          const removed = await diagrams.remove(id);
          return removed ? ok({ deleted: id }) : fail(`codegraph: no diagram with id "${id}".`);
        },
      },
    );
  }

  if (docs) {
    tools.push(
      {
        name: "save_doc",
        title: "Save doc",
        description:
          "Save a long-form Markdown doc you wrote ABOUT this repo onto its knowledge layer — the prose " +
          "layer above the structure graph and the Mermaid diagrams: an onboarding guide, a module " +
          "deep-dive, an architecture overview, 'how this subsystem fits together'. Explore first " +
          "(find_nodes, neighborhood, dependencies, blast_radius, graph_stats), then write the doc and " +
          "link it back to the graph with `related` node addresses. Prefer SEVERAL focused docs over one " +
          "giant one, each categorized — you choose the categories (suggested: " +
          `${KNOWN_DOC_CATEGORIES.join(", ")}). Re-saving the same title+category updates that doc in ` +
          "place. The human board and the web explorer render these (Markdown is sanitized at the render " +
          "edge). Writes graph metadata only; it never touches source files.",
        inputSchema: {
          title: z.string().min(1).describe("Short, specific title, e.g. 'Onboarding: the graph pipeline'."),
          category: z
            .string()
            .min(1)
            .describe(`Category — you decide (suggested: ${KNOWN_DOC_CATEGORIES.join(", ")}).`),
          markdown: z
            .string()
            .min(1)
            .describe("Markdown body. Use codegraph://node/<address> links to deep-link into the graph."),
          related: z
            .array(z.string())
            .optional()
            .describe("Graph node addresses this doc is about, to link it back to the graph."),
        },
        handler: async (args) => {
          const result = validateDoc({
            title: args.title,
            category: args.category,
            markdown: args.markdown,
            related: args.related,
            updatedAt: new Date().toISOString(),
          });
          if (!result.ok) return fail(`codegraph: ${result.error}`);
          await docs.save(result.doc);
          return ok({
            saved: result.doc.id,
            title: result.doc.title,
            category: result.doc.category,
          });
        },
      },
      {
        name: "list_docs",
        title: "List docs",
        description:
          "List the Markdown docs already saved for this repo (id, title, category, and related nodes). " +
          "Review these before adding more so you refine and fill gaps rather than duplicate.",
        inputSchema: {},
        handler: async () => ok(await docs.all()),
      },
      {
        name: "delete_doc",
        title: "Delete doc",
        description: "Delete a saved doc by its id (as returned by save_doc or list_docs).",
        inputSchema: {
          id: z.string().min(1).describe("The doc id, e.g. 'onboarding/the-graph-pipeline'."),
        },
        handler: async (args) => {
          const id = String(args.id);
          const removed = await docs.remove(id);
          return removed ? ok({ deleted: id }) : fail(`codegraph: no doc with id "${id}".`);
        },
      },
    );
  }

  if (overlays) {
    tools.push(...overlayWriteTools(getGraph, overlays));
  }

  if (diagrams && docs && overlays) {
    // The agent's on-install playbook (FR-42): assemble the ordered bootstrap plan
    // from the live graph + what's already authored across the three knowledge
    // stores, so a re-run skips finished work (idempotent). Pure core builds the
    // plan; this adapter just does the reads and serves it.
    tools.push({
      name: "codegraph_onboard",
      title: "Onboard this repo",
      description:
        "Run this FIRST when you attach to a repo. Returns an ordered, idempotent bootstrap checklist: " +
        "index the graph (already done on start), author a starter knowledge layer (a few diagrams via " +
        "save_diagram, an overview via save_doc, hotspot marks via mark_node), then hand off to the human. " +
        "Each step is marked done/todo from what's already saved, so re-running skips finished work and " +
        "shows only the gaps. Read-only; it recommends writes, it doesn't make them.",
      inputSchema: {},
      handler: async () => {
        const [diagramSet, docSet, overlaySet] = await Promise.all([
          diagrams.all(),
          docs.all(),
          overlays.all(),
        ]);
        return ok(
          buildOnboardPlaybook({
            stats: graphStats(getGraph()),
            diagrams: diagramSet,
            docs: docSet,
            overlays: overlaySet,
          }),
        );
      },
    });
  }

  if (commands) {
    // Build → re-validate through the SHARED core codec (the agent is UNTRUSTED, and
    // this guarantees the emitted command is byte-identical to what the webview will
    // re-validate) → emit onto the ephemeral bus. These tools DRIVE the live view;
    // unlike the overlay/doc/diagram write tools they persist NOTHING (FR-9, AD-14).
    const drive = async (raw: unknown): Promise<McpToolResult> => {
      const command = validatePresentationCommand(raw);
      if (!command) return fail("codegraph: not a valid presentation command.");
      await commands.emit(command);
      return ok({ presented: command });
    };

    tools.push(
      {
        name: "highlight_nodes",
        title: "Highlight nodes",
        description:
          "Point the human at a set of nodes on the LIVE board: a transient highlight that lifts them " +
          "above everything else (it overrides any persistent mark while engaged, and clears when you " +
          "highlight again or the human takes control). Use it while explaining — 'look at these' — not " +
          "to record anything (use mark_node for a durable badge). Style accent (default), trace, or warn. " +
          "Drives the view only; never touches source files. Requires the human to have the explorer open.",
        inputSchema: {
          addresses: z.array(ADDRESS).min(1).describe("The node addresses to highlight."),
          style: HIGHLIGHT_STYLE.optional().describe(`Highlight style: ${HIGHLIGHT_STYLES.join(", ")}.`),
        },
        handler: (args) =>
          drive({ kind: "highlight_nodes", addresses: args.addresses, style: args.style }),
      },
      {
        name: "highlight_path",
        title: "Highlight path",
        description:
          "Trace and highlight the dependency path between two nodes on the LIVE board — the board resolves " +
          "the route and lights it up (a 'trace' style). Use it to walk the human along a flow you're " +
          "explaining. Drives the view only; never touches source files.",
        inputSchema: {
          from: z.string().min(1).describe("Start node address."),
          to: z.string().min(1).describe("Target node address."),
        },
        handler: (args) => drive({ kind: "highlight_path", from: args.from, to: args.to }),
      },
      {
        name: "focus_camera",
        title: "Focus camera",
        description:
          "Move the LIVE board's camera to frame a set of nodes. By default it also selects the set's head " +
          "(opening its detail panel); pass select:false to only move the viewport without changing the " +
          "selection. Use it to bring the human's attention to a region. Drives the view only; never " +
          "touches source files.",
        inputSchema: {
          addresses: z.array(ADDRESS).min(1).describe("The node addresses to frame."),
          select: z
            .boolean()
            .optional()
            .describe("true (default) selects the set's head + frames it; false only moves the camera."),
        },
        handler: (args) =>
          drive({ kind: "focus_camera", addresses: args.addresses, select: args.select }),
      },
      {
        name: "set_projection",
        title: "Set projection",
        description:
          `Switch the LIVE board's projection (${PROJECTION_KINDS.join(", ")}) — full graph, the ` +
          "dependency view, the call view, or the structure (contains) view. Use it to reshape what the " +
          "human sees before walking them through it. Drives the view only; never touches source files.",
        inputSchema: {
          projection: PROJECTION.describe(`The projection to switch to: ${PROJECTION_KINDS.join(", ")}.`),
        },
        handler: (args) => drive({ kind: "set_projection", projection: args.projection }),
      },
      {
        name: "open_panel",
        title: "Open panel",
        description:
          `Open or close one of the board's panels (${PANEL_KINDS.join(", ")}) on the LIVE board — the ` +
          "diagrams drawer, the docs drawer, the ask panel, or the selected-node detail panel. Pass " +
          "open:false to close it. Use it to surface the knowledge you authored. Drives the view only; " +
          "never touches source files.",
        inputSchema: {
          panel: PANEL.describe(`Which panel: ${PANEL_KINDS.join(", ")}.`),
          open: z.boolean().optional().describe("true (default) opens, false closes."),
        },
        handler: (args) => drive({ kind: "open_panel", panel: args.panel, open: args.open }),
      },
      {
        name: "toggle_affordance",
        title: "Toggle affordance",
        description:
          `Toggle one of the board's view lenses (${AFFORDANCE_KINDS.join(", ")}) on the LIVE board — the ` +
          "orphans dim, the folder clustering, or the trace-path mode. Pass on:true/false for an explicit " +
          "state, or omit it to flip. Drives the view only; never touches source files.",
        inputSchema: {
          affordance: AFFORDANCE.describe(`Which lens: ${AFFORDANCE_KINDS.join(", ")}.`),
          on: z.boolean().optional().describe("Explicit desired state; omit to flip the current one."),
        },
        handler: (args) => drive({ kind: "toggle_affordance", affordance: args.affordance, on: args.on }),
      },
      {
        name: "reveal_in_editor",
        title: "Reveal in editor",
        description:
          "Open a node in the human's REAL editor, jumping to its file and line — the " +
          "'now look at the actual code' verb. Pair it with find_symbol / find_nodes: " +
          "locate the node, then reveal it so the human lands right on it. The host " +
          "resolves the address to its file:line and opens it read-only; no source or " +
          "path travels through the command. Requires the human to have the codegraph " +
          "editor extension running (it is a no-op on the web board).",
        inputSchema: {
          address: ADDRESS.describe("The node address to open in the editor."),
        },
        handler: (args) => drive({ kind: "reveal", address: String(args.address) }),
      },
      {
        name: "guided_tour",
        title: "Guided tour",
        description:
          "Walk the human through an ORDERED sequence of nodes on the LIVE board over time — a guided tour. " +
          "The board lights each stop in turn (a growing trace trail) and follows the camera, pausing " +
          "dwellMs at each, with a 'replaying…' banner the human can interrupt at any step. Use it to " +
          "narrate a flow step by step — e.g. request → handler → service → store. Pass the addresses in " +
          "the order you want them visited. Drives the view only; never touches source files. Requires the " +
          "human to have the explorer open.",
        inputSchema: {
          addresses: z.array(ADDRESS).min(1).describe("The tour stops, in the order to visit them."),
          dwellMs: z
            .number()
            .optional()
            .describe("Pause per stop in ms (clamped 200–10000; default 1200)."),
        },
        handler: (args) => drive({ kind: "replay", addresses: args.addresses, dwellMs: args.dwellMs }),
      },
      {
        name: "replay_trace",
        title: "Replay a stack trace",
        description:
          "Turn a runtime stack trace or error log into a guided tour on the LIVE board — paste the raw " +
          "trace text and the board walks the human through the nodes it touched, in the order the trace " +
          "lists them (innermost-first for Node/V8, outermost-first for Python). Frames that don't map to a " +
          "known node are skipped; if none map, nothing happens. Use it to walk a crash or a profiled path. " +
          "Drives the view only; never touches source files. Requires the human to have the explorer open.",
        inputSchema: {
          trace: z.string().min(1).describe("The raw stack trace / error log text."),
          dwellMs: z
            .number()
            .optional()
            .describe("Pause per stop in ms (clamped 200–10000; default 1200)."),
        },
        handler: (args) => {
          const addresses = traceToAddresses(args.trace, getGraph().allNodes());
          if (addresses.length === 0) {
            return fail("codegraph: no frames in that trace mapped to a known node.");
          }
          return drive({ kind: "replay", addresses, dwellMs: args.dwellMs });
        },
      },
    );
  }

  return tools;
}
