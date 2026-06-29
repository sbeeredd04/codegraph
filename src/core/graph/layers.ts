import type { GraphEdge, NodeAddress } from "./types.js";

// Layered neighbour analysis (FR-72): given a selected node, the concentric BFS
// layers around it — depth 0 is the node itself, depth 1 its first-degree
// neighbours, depth 2 their neighbours, and so on outward to the end. Pure and
// edge-array based (AD-1), the multi-hop generalization of focus.ts's first-degree
// lens, so both the 2D Sigma canvas and the 3D canvas compute the same depth map
// from the snapshot edges they already hold — no CodeGraph, no I/O. A render
// surface colours each layer with a brand hue that dims with depth, letting the
// eye read distance-from-focus as a gradient. Undirected (a caller and a callee
// are both one hop away), matching focus.ts and query.ts's neighborhood.

export interface LayeredNeighbourhood {
  /** The selected node — depth 0, painted brightest. */
  readonly center: NodeAddress;
  /** address → BFS depth (0 = centre) for every node reached within `maxDepth`. */
  readonly depthOf: ReadonlyMap<NodeAddress, number>;
  /** Nodes grouped by depth: `layers[d]` is every node exactly `d` hops out;
   * `layers[0]` is always `[center]`. Discovery order within a layer is stable. */
  readonly layers: readonly (readonly NodeAddress[])[];
  /** The deepest populated layer index (`layers.length - 1`). */
  readonly maxReached: number;
}

/** Build undirected adjacency from the edge array (both directions, self-edges
 * dropped so the centre never re-enters its own neighbourhood). */
function adjacency(edges: readonly GraphEdge[]): Map<NodeAddress, Set<NodeAddress>> {
  const adj = new Map<NodeAddress, Set<NodeAddress>>();
  const link = (a: NodeAddress, b: NodeAddress): void => {
    let s = adj.get(a);
    if (!s) {
      s = new Set<NodeAddress>();
      adj.set(a, s);
    }
    s.add(b);
  };
  for (const e of edges) {
    if (e.from === e.to) continue;
    link(e.from, e.to);
    link(e.to, e.from);
  }
  return adj;
}

/**
 * Build the concentric BFS layers around a selected node (FR-72). Each node is
 * placed at its shortest undirected hop-distance from `address`; a node already
 * reached at a shallower depth is never re-placed deeper. Returns null for a
 * null/empty selection (no lens — the full graph shows). `maxDepth` caps how far
 * out to explore (default: to the end of the reachable component); a negative cap
 * is treated as 0, yielding just the centre.
 */
export function layeredNeighbourhood(
  address: NodeAddress | null | undefined,
  edges: readonly GraphEdge[],
  maxDepth: number = Number.POSITIVE_INFINITY,
): LayeredNeighbourhood | null {
  if (!address) return null;
  const cap = maxDepth < 0 ? 0 : maxDepth;

  const adj = adjacency(edges);
  const depthOf = new Map<NodeAddress, number>([[address, 0]]);
  const layers: NodeAddress[][] = [[address]];
  let frontier: NodeAddress[] = [address];

  for (let depth = 1; depth <= cap; depth += 1) {
    const next: NodeAddress[] = [];
    for (const cur of frontier) {
      for (const nb of adj.get(cur) ?? []) {
        if (!depthOf.has(nb)) {
          depthOf.set(nb, depth);
          next.push(nb);
        }
      }
    }
    if (next.length === 0) break;
    layers.push(next);
    frontier = next;
  }

  return { center: address, depthOf, layers, maxReached: layers.length - 1 };
}
