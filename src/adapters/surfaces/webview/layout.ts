// Stable live layout (FR-5 polish): when the watch loop re-scans and repaints,
// the graph must NOT jump. Re-running force-directed layout from scratch moves
// every node; instead we keep each surviving node where it already sits and only
// place genuinely-new nodes — near the neighbours they attach to. Pure (no DOM),
// so the placement rule is unit-tested away from Sigma.

export interface XY {
  readonly x: number;
  readonly y: number;
}

/** A node carrying its fallback seed position (the deterministic circle seed). */
export interface SeedNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface LayoutEdge {
  readonly source: string;
  readonly target: string;
}

/**
 * Reconcile positions across a repaint: a node already present keeps its exact
 * prior position; a new node is dropped at the centroid of its already-placed
 * neighbours (so an added function lands next to the module that contains it),
 * falling back to its own seed when it has no placed neighbour yet. Existing
 * nodes never move, so the camera and the user's mental map stay put.
 */
export function reconcilePositions(
  nodes: readonly SeedNode[],
  edges: readonly LayoutEdge[],
  previous: ReadonlyMap<string, XY>,
): Map<string, XY> {
  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  const result = new Map<string, XY>();
  for (const node of nodes) {
    const kept = previous.get(node.id);
    if (kept) {
      result.set(node.id, kept);
      continue;
    }
    let sx = 0;
    let sy = 0;
    let placed = 0;
    for (const nb of neighbors.get(node.id) ?? []) {
      const p = previous.get(nb);
      if (p) {
        sx += p.x;
        sy += p.y;
        placed += 1;
      }
    }
    result.set(node.id, placed > 0 ? { x: sx / placed, y: sy / placed } : { x: node.x, y: node.y });
  }
  return result;
}
