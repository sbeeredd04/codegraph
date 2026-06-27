import { z } from "zod";
import type { CodeGraph } from "../../core/graph/graph.js";
import type { NodeKind } from "../../core/graph/types.js";
import {
  findNodes,
  describeNode,
  blastRadius,
  dependencies,
  graphStats,
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
  readonly handler: (args: Record<string, unknown>) => McpToolResult;
}

const KIND = z.enum(["module", "class", "function", "method", "workflow"]);
const ADDRESS = z.string().min(1).describe("A node address, e.g. ts:src/auth.ts#login");

const ok = (data: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): McpToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** Build the graph tools bound to a graph accessor (re-read each call so live updates show). */
export function graphTools(getGraph: () => CodeGraph): GraphTool[] {
  return [
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
        const detail = describeNode(getGraph(), String(args.address));
        return detail ? ok(detail) : fail(`codegraph: no node at address "${String(args.address)}".`);
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
}
