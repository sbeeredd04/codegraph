import type { CodeGraph } from "./graph.js";
import type { EdgeType, GraphNode, NodeAddress, NodeKind } from "./types.js";
import { forwardAdjacency, reverseAdjacency, transitiveClosure, DEPENDENCY_EDGES } from "./reachability.js";
import { searchNodes, type SearchableNode } from "../search/node-search.js";
import { partitionByPackage, type PackageInfo } from "./package.js";
import { detectEntryPoints } from "./entry-point.js";

// Pure graph-query layer (Epic 3 / FR-13): the read-only questions an AI agent
// asks of the graph through MCP — find a node, describe its edges, trace blast
// radius and dependencies. No I/O, no SDK (AD-1); the MCP adapter wraps these.
//
// FR-77 (the agent bridge): lookup is RANKED (the shared fzf-style core scorer,
// identical to the human ⌘K) and returns exact `file:line` PLUS relationships —
// a superset of grep, which can only give locations.

const NODE_KINDS: readonly NodeKind[] = ["module", "class", "function", "method", "workflow"];
/** The declaration kinds a "symbol" lookup targets (everything but a whole file). */
const SYMBOL_KINDS: readonly NodeKind[] = ["function", "method", "class", "workflow"];
const DEFAULT_LIMIT = 50;

export interface NodeSummary {
  readonly address: NodeAddress;
  readonly kind: NodeKind;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly signature?: string;
  /** Leading decorators (FR-85), e.g. a FastAPI route — structural, cloud-safe. */
  readonly decorators?: readonly string[];
}

export interface NodeDetail {
  readonly node: NodeSummary;
  readonly outbound: { readonly relation: EdgeType; readonly targets: NodeAddress[] }[];
  /** Direct dependents (callers / importers), structural containment excluded. */
  readonly dependents: NodeAddress[];
}

export interface GraphStats {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly byKind: Record<NodeKind, number>;
}

export interface Neighborhood {
  readonly center: NodeAddress;
  readonly radius: number;
  readonly nodes: NodeSummary[];
  readonly edges: { readonly from: NodeAddress; readonly to: NodeAddress; readonly type: EdgeType }[];
}

function summarize(node: GraphNode): NodeSummary {
  return {
    address: node.address,
    kind: node.kind,
    name: node.name,
    file: node.location.file,
    line: node.location.line,
    ...(node.signature ? { signature: node.signature } : {}),
    ...(node.decorators ? { decorators: node.decorators } : {}),
  };
}

/**
 * Rank the graph's nodes against `query` with the shared fzf-style scorer (the
 * same one behind the human ⌘K), returning the matched GraphNodes in rank order.
 * `nameOf` picks what the query scores against (the node name by default; the file
 * path for a file lookup). Restrict to `kinds` and cap at `limit`. An empty query
 * returns the first `limit` (kind-filtered) nodes so an open lookup shows something.
 */
function rankNodes(
  graph: CodeGraph,
  query: string,
  opts: { kinds?: readonly NodeKind[]; limit?: number; nameOf?: (n: GraphNode) => string } = {},
): GraphNode[] {
  const nameOf = opts.nameOf ?? ((n: GraphNode) => n.name);
  const searchable: SearchableNode[] = [];
  for (const n of graph.allNodes()) searchable.push({ address: n.address, name: nameOf(n), kind: n.kind });
  const ranked = searchNodes(searchable, query, { kinds: opts.kinds, limit: opts.limit ?? DEFAULT_LIMIT });
  const out: GraphNode[] = [];
  for (const r of ranked) {
    const n = graph.getNode(r.address);
    if (n) out.push(n);
  }
  return out;
}

/** Ranked fuzzy match on a node's name (falling back to its address); optional
 *  kind filter and limit. Upgraded from an unranked substring scan (FR-77). */
export function findNodes(
  graph: CodeGraph,
  query: string,
  opts: { kind?: NodeKind; limit?: number } = {},
): NodeSummary[] {
  return rankNodes(graph, query, {
    kinds: opts.kind ? [opts.kind] : undefined,
    limit: opts.limit ?? DEFAULT_LIMIT,
  }).map(summarize);
}

/** Ranked file lookup (FR-77): match against the module PATH, so `client/index`
 *  finds `packages/client/src/index.ts`. Modules only. */
export function findFiles(
  graph: CodeGraph,
  query: string,
  opts: { limit?: number } = {},
): NodeSummary[] {
  return rankNodes(graph, query, {
    kinds: ["module"],
    limit: opts.limit ?? DEFAULT_LIMIT,
    nameOf: (n) => n.location.file,
  }).map(summarize);
}

/**
 * Ranked SYMBOL lookup (FR-77) — the superset-of-grep. Fuzzy-match functions /
 * methods / classes and return each with its immediate relationships (outbound
 * edges by relation + direct dependents), so the agent gets the exact location
 * AND the call/import wiring in one call — what grep structurally cannot.
 */
export function findSymbols(
  graph: CodeGraph,
  query: string,
  opts: { limit?: number } = {},
): NodeDetail[] {
  const nodes = rankNodes(graph, query, { kinds: SYMBOL_KINDS, limit: opts.limit ?? 10 });
  const out: NodeDetail[] = [];
  for (const n of nodes) {
    const detail = describeNode(graph, n.address);
    if (detail) out.push(detail);
  }
  return out;
}

/** The monorepo package partition (FR-57) — id, human label, node count, most
 *  populated first. Lets the agent see the subsystem layout before drilling in. */
export function listPackages(graph: CodeGraph): readonly PackageInfo[] {
  return partitionByPackage(graph.allNodes()).packages;
}

/** An entry point with its ranked reason (FR-56) — "where does execution start?". */
export interface EntryPointSummary extends NodeSummary {
  readonly reason: string;
  readonly score: number;
}

/** The graph's likely entry points (FR-56), strongest first, capped at `limit`. */
export function entryPoints(graph: CodeGraph, limit = 20): EntryPointSummary[] {
  const ranked = detectEntryPoints(graph.allNodes(), graph.allEdges());
  const out: EntryPointSummary[] = [];
  for (const ep of ranked.slice(0, limit)) {
    const node = graph.getNode(ep.address);
    if (node) out.push({ ...summarize(node), reason: ep.reason, score: ep.score });
  }
  return out;
}

/** A node with its outbound edges grouped by relation and its direct dependents. */
export function describeNode(graph: CodeGraph, address: NodeAddress): NodeDetail | undefined {
  const node = graph.getNode(address);
  if (!node) return undefined;

  const byRelation = new Map<EdgeType, NodeAddress[]>();
  for (const e of graph.allEdges()) {
    if (e.from !== address) continue;
    const list = byRelation.get(e.type);
    if (list) list.push(e.to);
    else byRelation.set(e.type, [e.to]);
  }
  const dependents = reverseAdjacency(graph, DEPENDENCY_EDGES).get(address) ?? [];

  return {
    node: summarize(node),
    outbound: [...byRelation].map(([relation, targets]) => ({ relation, targets })),
    dependents,
  };
}

/** Transitive dependents (impact set) following dependency edges only. */
export function blastRadius(
  graph: CodeGraph,
  address: NodeAddress,
): { address: NodeAddress; count: number; impacted: NodeAddress[] } {
  const impacted = transitiveClosure(address, reverseAdjacency(graph, DEPENDENCY_EDGES));
  return { address, count: impacted.length, impacted };
}

/** Transitive dependencies (what this node relies on) following dependency edges only. */
export function dependencies(
  graph: CodeGraph,
  address: NodeAddress,
): { address: NodeAddress; count: number; dependsOn: NodeAddress[] } {
  const dependsOn = transitiveClosure(address, forwardAdjacency(graph, DEPENDENCY_EDGES));
  return { address, count: dependsOn.length, dependsOn };
}

export function graphStats(graph: CodeGraph): GraphStats {
  const byKind = Object.fromEntries(NODE_KINDS.map((k) => [k, 0])) as Record<NodeKind, number>;
  for (const node of graph.allNodes()) byKind[node.kind] += 1;
  return { nodeCount: graph.order, edgeCount: graph.size, byKind };
}

/**
 * The local map around a node: every node within `radius` hops in either
 * direction (callers and callees, container and contents) plus the edges among
 * them. Lets an agent "zoom in" on a region. Uses all edge types — structure is
 * part of the local picture. Returns undefined if the center node is unknown.
 */
export function neighborhood(graph: CodeGraph, address: NodeAddress, radius = 1): Neighborhood | undefined {
  if (!graph.getNode(address)) return undefined;

  // Undirected adjacency: the neighborhood spans both directions.
  const adj = new Map<NodeAddress, Set<NodeAddress>>();
  const link = (a: NodeAddress, b: NodeAddress): void => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  };
  for (const e of graph.allEdges()) {
    link(e.from, e.to);
    link(e.to, e.from);
  }

  // BFS out to `radius` hops.
  const included = new Set<NodeAddress>([address]);
  let frontier: NodeAddress[] = [address];
  for (let hop = 0; hop < radius; hop += 1) {
    const next: NodeAddress[] = [];
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (!included.has(nb)) {
          included.add(nb);
          next.push(nb);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  const nodes: NodeSummary[] = [];
  for (const addr of included) {
    const node = graph.getNode(addr);
    if (node) nodes.push(summarize(node));
  }
  const edges = graph
    .allEdges()
    .filter((e) => included.has(e.from) && included.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, type: e.type }));

  return { center: address, radius, nodes, edges };
}
