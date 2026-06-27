import type { CodeGraph } from "./graph.js";
import type { GraphDelta, GraphNode, NodeAddress, NodeKind } from "./types.js";
import { reverseAdjacency, transitiveClosure, DEPENDENCY_EDGES } from "./reachability.js";

// Ranked change feed (FR-7 triage): turn a GraphDelta into a list of changes
// ordered by blast radius — how many nodes transitively depend on the changed
// node. The biggest-impact change rises to the top so the user judges what
// matters first. Pure: operates on the in-memory graph only (AD-1).

export type ChangeType = "added" | "removed" | "changed" | "moved";

export interface RankedChange {
  readonly address: NodeAddress;
  readonly name: string;
  readonly kind: NodeKind;
  readonly change: ChangeType;
  /** Count of nodes that transitively reach this node (its dependents). */
  readonly blastRadius: number;
  /** The impacted dependents, capped for display. */
  readonly dependents: readonly NodeAddress[];
}

// Removed/changed code breaks callers harder than a fresh addition — break ties by severity.
const SEVERITY: Record<ChangeType, number> = { removed: 3, changed: 2, moved: 1, added: 0 };
const MAX_DEPENDENTS = 25;

/**
 * Rank a delta's changes by blast radius. Added/changed/moved nodes live in the
 * `after` graph; removed nodes are scored against `before` (where their
 * dependents still existed). Ties break by severity, then address (deterministic).
 */
export function rankedChangeFeed(delta: GraphDelta, before: CodeGraph, after: CodeGraph): RankedChange[] {
  const revBefore = reverseAdjacency(before, DEPENDENCY_EDGES);
  const revAfter = reverseAdjacency(after, DEPENDENCY_EDGES);

  const score = (address: NodeAddress, change: ChangeType): RankedChange => {
    const graph = change === "removed" ? before : after;
    const rev = change === "removed" ? revBefore : revAfter;
    const dependents = transitiveClosure(address, rev);
    const meta = graph.getNode(address);
    return {
      address,
      name: meta?.name ?? address.split(/[#.]/).pop() ?? address,
      kind: meta?.kind ?? "function",
      change,
      blastRadius: dependents.length,
      dependents: dependents.slice(0, MAX_DEPENDENTS),
    };
  };

  const feed: RankedChange[] = [
    ...delta.added.map((n: GraphNode) => score(n.address, "added")),
    ...delta.removed.map((addr) => score(addr, "removed")),
    ...delta.changed.map((c) => score(c.address, "changed")),
    ...delta.movedRenamed.map((m) => score(m.to, "moved")),
  ];

  feed.sort(
    (a, b) =>
      b.blastRadius - a.blastRadius ||
      SEVERITY[b.change] - SEVERITY[a.change] ||
      a.address.localeCompare(b.address),
  );
  return feed;
}
