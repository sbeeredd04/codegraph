import type { GraphEdge, NodeAddress } from "./types.js";
import { pathEdgeKey } from "./path.js";

// Focus lens (FR-25): given a selected node, the first-degree neighbourhood that
// a render surface lifts out of the hairball. Pure and edge-array based (AD-1) so
// both the 2D Sigma canvas and the 3D canvas compute the same focus set from the
// snapshot edges they already hold — no CodeGraph, no I/O. The undirected sibling
// of path.ts's directed trace: "what touches this" is direction-agnostic, so a
// caller and a callee are both neighbours. Reuses `pathEdgeKey` so the incident
// edges key identically to the trace lens and the reducers can treat both alike.

/** First-degree neighbours of `address`: every node one edge away in EITHER
 * direction (callers + callees, container + contents), de-duplicated, self
 * excluded. */
export function neighborsOf(
  address: NodeAddress,
  edges: readonly GraphEdge[],
): Set<NodeAddress> {
  const out = new Set<NodeAddress>();
  for (const e of edges) {
    if (e.from === address && e.to !== address) out.add(e.to);
    else if (e.to === address && e.from !== address) out.add(e.from);
  }
  return out;
}

export interface FocusHighlight {
  /** The selected node — leads, painted brightest. */
  readonly center: NodeAddress;
  /** `center` + its first-degree neighbours — the in-focus node set. */
  readonly nodes: ReadonlySet<NodeAddress>;
  /** `pathEdgeKey` of every edge incident to `center` — the wiring to emphasize. */
  readonly edges: ReadonlySet<string>;
}

/** Build the focus lens for a selected node: the node itself plus its
 * first-degree neighbours lead, and every incident edge is keyed so a surface can
 * emphasize the direct wiring and recede everything else (FR-25). Returns null for
 * a null/empty selection (no lens — the full graph shows). */
export function focusHighlight(
  address: NodeAddress | null | undefined,
  edges: readonly GraphEdge[],
): FocusHighlight | null {
  if (!address) return null;
  const nodes = new Set<NodeAddress>([address]);
  const edgeKeys = new Set<string>();
  for (const e of edges) {
    if (e.from === address) {
      if (e.to !== address) nodes.add(e.to);
      edgeKeys.add(pathEdgeKey(e.from, e.to));
    } else if (e.to === address) {
      nodes.add(e.from);
      edgeKeys.add(pathEdgeKey(e.from, e.to));
    }
  }
  return { center: address, nodes, edges: edgeKeys };
}
