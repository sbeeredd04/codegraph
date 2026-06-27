import type { CodeGraph } from "./graph.js";
import type { EdgeType, GraphNode, NodeAddress, NodeKind } from "./types.js";
import { forwardAdjacency, reverseAdjacency, transitiveClosure, DEPENDENCY_EDGES } from "./reachability.js";

// Pure graph-query layer (Epic 3 / FR-13): the read-only questions an AI agent
// asks of the graph through MCP — find a node, describe its edges, trace blast
// radius and dependencies. No I/O, no SDK (AD-1); the MCP adapter wraps these.

const NODE_KINDS: readonly NodeKind[] = ["module", "class", "function", "method", "workflow"];
const DEFAULT_LIMIT = 50;

export interface NodeSummary {
  readonly address: NodeAddress;
  readonly kind: NodeKind;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly signature?: string;
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

function summarize(node: GraphNode): NodeSummary {
  return {
    address: node.address,
    kind: node.kind,
    name: node.name,
    file: node.location.file,
    line: node.location.line,
    ...(node.signature ? { signature: node.signature } : {}),
  };
}

/** Substring match on name or address (case-insensitive); optional kind filter and limit. */
export function findNodes(
  graph: CodeGraph,
  query: string,
  opts: { kind?: NodeKind; limit?: number } = {},
): NodeSummary[] {
  const needle = query.trim().toLowerCase();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const out: NodeSummary[] = [];
  for (const node of graph.allNodes()) {
    if (opts.kind && node.kind !== opts.kind) continue;
    if (
      needle &&
      !node.name.toLowerCase().includes(needle) &&
      !node.address.toLowerCase().includes(needle)
    ) {
      continue;
    }
    out.push(summarize(node));
    if (out.length >= limit) break;
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
