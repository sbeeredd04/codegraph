import { z } from "zod";
import type { CodeGraph } from "../../core/graph/graph.js";
import type { EdgeType, NodeKind } from "../../core/graph/types.js";
import type { NodeAnnotations } from "../../core/semantic/annotations.js";
import { ok, fail, ADDRESS, type GraphTool } from "./mcp-tool.js";
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
import { findPath } from "../../core/graph/path.js";
import { answerQuestion } from "../../core/query/answer.js";

// The always-on READ surface (Epic 3 / FR-13 / FR-77 / FR-95): the read-only questions
// the agent asks of the live graph — a thin wrapper over the pure query layer. Always
// present (no capability gate). `annotations` is optional: when the host wires the
// store, describe_node folds in the node's stored enrichment.

const KIND = z.enum(["module", "class", "function", "method", "workflow"]);
const EDGE_TYPE = z.enum(["calls", "depends-on", "contains", "hands-off-to", "overrides"]);

export function readTools(getGraph: () => CodeGraph, annotations?: NodeAnnotations): GraphTool[] {
  return [
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
        "the node path, or found:false when no such route exists. Virtual dispatch is resolved: a " +
        "call that statically lands on an abstract base method continues to the concrete override " +
        "reached at runtime. Pass edgeTypes to trace other relations (e.g. include 'contains' to " +
        "walk structure, or 'overrides' to see which base-class method a method overrides).",
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
}
