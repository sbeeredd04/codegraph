import type { CodeGraph } from "./graph.js";
import type { EdgeType, NodeAddress } from "./types.js";
import { DEPENDENCY_EDGES } from "./reachability.js";

// Path-finding over the edge set (pure, AD-1): "how does A reach B?" — the
// shortest directed chain of edges from one node to another. The MCP `find_path`
// tool wraps this so the agent can trace a request or data flow end to end and
// turn the chain into a sequence/flow diagram. Reachability's adjacency helpers
// drop the edge type; here we keep it, because the type of each hop (a call vs an
// import vs a workflow hand-off) is the point of the trace.

export interface PathStep {
  readonly from: NodeAddress;
  readonly to: NodeAddress;
  readonly type: EdgeType;
}

export interface PathResult {
  readonly from: NodeAddress;
  readonly to: NodeAddress;
  /** Whether a route exists under the allowed edge types. */
  readonly found: boolean;
  /** The edges traversed, in order from `from` to `to`. Empty when not found or from === to. */
  readonly steps: readonly PathStep[];
  /** The node addresses along the path, both ends inclusive. Empty when not found. */
  readonly nodes: readonly NodeAddress[];
  /** Edge count (nodes.length - 1); 0 when from === to. */
  readonly length: number;
}

export interface FindPathOptions {
  /** Edge types to traverse. Default: dependency edges (calls/depends-on/hands-off-to);
   * structural `contains` is excluded since containment is not a flow. */
  readonly edgeTypes?: ReadonlySet<EdgeType>;
}

const NOT_FOUND = (from: NodeAddress, to: NodeAddress): PathResult => ({
  from,
  to,
  found: false,
  steps: [],
  nodes: [],
  length: 0,
});

/**
 * Shortest directed path from `from` to `to` following the allowed edge types
 * (default: dependency edges). Breadth-first, so the first route found is the
 * fewest-hops one; cycle-safe via a visited set. Returns `undefined` when either
 * endpoint is not a node in the graph (an unknown address, distinct from "no
 * path"); a found result with `length: 0` when `from === to`.
 */
export function findPath(
  graph: CodeGraph,
  from: NodeAddress,
  to: NodeAddress,
  opts: FindPathOptions = {},
): PathResult | undefined {
  if (!graph.getNode(from) || !graph.getNode(to)) return undefined;

  const allowed = opts.edgeTypes ?? DEPENDENCY_EDGES;

  // Typed forward adjacency: from -> the steps leaving it (keeping the edge type).
  const fwd = new Map<NodeAddress, PathStep[]>();
  for (const e of graph.allEdges()) {
    if (!allowed.has(e.type)) continue;
    const step: PathStep = { from: e.from, to: e.to, type: e.type };
    const list = fwd.get(e.from);
    if (list) list.push(step);
    else fwd.set(e.from, [step]);
  }

  // BFS, recording the edge that first reached each node so the path can be rebuilt.
  const prev = new Map<NodeAddress, PathStep>();
  const visited = new Set<NodeAddress>([from]);
  const queue: NodeAddress[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    if (cur === to) break;
    for (const step of fwd.get(cur) ?? []) {
      if (!visited.has(step.to)) {
        visited.add(step.to);
        prev.set(step.to, step);
        queue.push(step.to);
      }
    }
  }
  if (!visited.has(to)) return NOT_FOUND(from, to);

  // Walk predecessors back from `to` (no-op when from === to → zero-length path).
  const steps: PathStep[] = [];
  for (let cur = to; cur !== from; ) {
    const step = prev.get(cur);
    if (!step) break; // unreachable in practice once visited.has(to) holds
    steps.push(step);
    cur = step.from;
  }
  steps.reverse();
  const nodes = [from, ...steps.map((s) => s.to)];
  return { from, to, found: true, steps, nodes, length: steps.length };
}
