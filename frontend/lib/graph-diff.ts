// FR-69 — compute a structural graph delta between a captured baseline snapshot and
// the live graph, entirely client-side from data already on the frontend. It builds
// two pure-core CodeGraphs from the snapshot node/edge arrays and runs the SAME tested
// diff the extension uses (diffGraphs → GraphDelta with node-identity matching, so a
// rename/move doesn't read as delete+create), then projects it to a per-node tint map
// (changesFromDelta — added/changed/moved; removed nodes are gone from the board so
// they're omitted) plus the impact-ranked feed (rankedChangeFeed) and the +/−/~/→
// counts (deltaCounts). AD-14-safe: the delta is graph identities + change kinds +
// relative-path metadata only — never source bytes, never an absolute host path.

import { CodeGraph } from "@core/graph/graph";
import { diffGraphs } from "@core/graph/diff";
import { rankedChangeFeed, type RankedChange } from "@core/graph/change-feed";
import {
  changesFromDelta,
  deltaCounts,
  type ChangeKind,
  type DeltaCounts,
} from "@adapters/surfaces/webview/render-model";
import type { GraphNode, GraphEdge } from "@core/graph/types";

export interface GraphSnapshotInput {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface GraphDiffResult {
  /** address → change kind (added | changed | moved). Removed nodes are absent —
   * they're gone from the live graph; they appear only in `feed`. */
  readonly changeMap: ReadonlyMap<string, ChangeKind>;
  /** +N / −N / ~N / →N tallies for the panel summary. */
  readonly counts: DeltaCounts;
  /** Every change, ranked by blast radius (the biggest-impact change first). */
  readonly feed: readonly RankedChange[];
}

function toCodeGraph(input: GraphSnapshotInput): CodeGraph {
  const g = new CodeGraph();
  for (const n of input.nodes) g.addNode(n);
  for (const e of input.edges) g.addEdge(e);
  return g;
}

/** Diff a baseline snapshot against the current graph into a render-ready result. */
export function computeGraphDiff(
  baseline: GraphSnapshotInput,
  current: GraphSnapshotInput,
): GraphDiffResult {
  const before = toCodeGraph(baseline);
  const after = toCodeGraph(current);
  const delta = diffGraphs(before, after);
  return {
    changeMap: changesFromDelta(delta),
    counts: deltaCounts(delta),
    feed: rankedChangeFeed(delta, before, after),
  };
}
