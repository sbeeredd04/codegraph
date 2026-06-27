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
import {
  findNodes,
  describeNode,
  blastRadius,
  dependencies,
  graphStats,
  neighborhood,
} from "../../core/graph/query.js";

// MCP tool surface (Epic 3 / FR-13): the read-only questions the user's AI
// agent asks of the live graph — the same map the human reads. Each tool is a
// thin wrapper over the pure query layer, kept here (not in server.ts) so the
// handlers are testable without standing up the SDK transport.

export interface McpToolResult {
  readonly content: { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
  // The SDK's CallToolResult carries an open index signature; mirror it so a
  // handler result is assignable to registerTool's callback return type.
  readonly [key: string]: unknown;
}

export interface GraphTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
  readonly handler: (args: Record<string, unknown>) => McpToolResult | Promise<McpToolResult>;
}

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

const KIND = z.enum(["module", "class", "function", "method", "workflow"]);
const ADDRESS = z.string().min(1).describe("A node address, e.g. ts:src/auth.ts#login");

const ok = (data: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): McpToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/**
 * Build the graph tools bound to a graph accessor (re-read each call so live
 * updates show). Pass `recentChanges` to also expose the `recent_changes` tool —
 * the live "what just changed" feed (omitted in graph-only contexts that have no
 * git baseline to diff against).
 */
export function graphTools(
  getGraph: () => CodeGraph,
  recentChanges?: RecentChangesProvider,
  annotations?: NodeAnnotations,
  diagrams?: DiagramStore,
): GraphTool[] {
  const tools: GraphTool[] = [
    {
      name: "find_nodes",
      title: "Find nodes",
      description:
        "Search the code graph for nodes whose name or address matches a substring. " +
        "Optionally filter by kind. Returns address, kind, name, and file location.",
      inputSchema: {
        query: z.string().describe("Case-insensitive substring to match on name or address."),
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

  return tools;
}
