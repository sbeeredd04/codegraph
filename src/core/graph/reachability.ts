import type { CodeGraph } from "./graph.js";
import type { EdgeType, NodeAddress } from "./types.js";

// Reachability over the edge set (pure, AD-1). Shared by the change feed
// (blast radius = reverse reachability) and the MCP query layer (dependencies =
// forward reachability). Both directions are built the same way; the only
// difference is which endpoint keys the adjacency map.

// Impact follows dependency edges, not structural containment: a module
// "contains" a function, but the module is not a dependent of it. Excluding
// `contains` keeps blast radius and dependency closure meaningful.
export const DEPENDENCY_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>([
  "calls",
  "depends-on",
  "hands-off-to",
]);

/** from -> [to...]: what each node points at (its dependencies / callees). */
export function forwardAdjacency(
  graph: CodeGraph,
  edgeTypes?: ReadonlySet<EdgeType>,
): Map<NodeAddress, NodeAddress[]> {
  const fwd = new Map<NodeAddress, NodeAddress[]>();
  for (const e of graph.allEdges()) {
    if (edgeTypes && !edgeTypes.has(e.type)) continue;
    const list = fwd.get(e.from);
    if (list) list.push(e.to);
    else fwd.set(e.from, [e.to]);
  }
  return fwd;
}

/** to -> [from...]: what points at each node (its dependents / callers). */
export function reverseAdjacency(
  graph: CodeGraph,
  edgeTypes?: ReadonlySet<EdgeType>,
): Map<NodeAddress, NodeAddress[]> {
  const rev = new Map<NodeAddress, NodeAddress[]>();
  for (const e of graph.allEdges()) {
    if (edgeTypes && !edgeTypes.has(e.type)) continue;
    const list = rev.get(e.to);
    if (list) list.push(e.from);
    else rev.set(e.to, [e.from]);
  }
  return rev;
}

/** Every node reachable from `start` via `adj`, excluding `start` itself. Cycle-safe. */
export function transitiveClosure(
  start: NodeAddress,
  adj: Map<NodeAddress, NodeAddress[]>,
): NodeAddress[] {
  const seen = new Set<NodeAddress>();
  const stack = [...(adj.get(start) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop() as NodeAddress;
    if (cur === start || seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) ?? []) if (!seen.has(n)) stack.push(n);
  }
  return [...seen];
}
