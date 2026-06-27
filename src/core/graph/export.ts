// Portable graph snapshot (Epic 6 foundation): a versioned, self-contained,
// JSON-serializable view of the canonical graph. This is the data contract the
// standalone web viewer consumes, and a useful artifact on its own — a shareable,
// diffable snapshot a user can export, archive, or feed to another tool.
//
// Kept pure (AD-1): it takes arrays and returns a plain object. No I/O, no clock —
// the timestamp is injected by the adapter that writes the file, so the core stays
// deterministic and testable.

import type { GraphNode, GraphEdge, NodeAddress } from "./types.js";
import type { NodeEnrichment } from "../semantic/enrichment.js";

/** Bump when the snapshot shape changes so consumers can refuse what they can't read. */
export const GRAPH_SNAPSHOT_VERSION = 1 as const;

export interface GraphSnapshot {
  readonly version: number;
  /** ISO-8601 export time, injected by the adapter (the core never reads a clock). */
  readonly generatedAt?: string;
  /** The repo root this snapshot was taken from, for display/provenance. */
  readonly root?: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Agent-written annotations, keyed by node address — present only when non-empty. */
  readonly enrichments?: Readonly<Record<NodeAddress, NodeEnrichment>>;
}

export interface ExportOptions {
  readonly enrichments?: ReadonlyMap<NodeAddress, NodeEnrichment>;
  readonly generatedAt?: string;
  readonly root?: string;
}

/**
 * Build a portable snapshot of the graph. A Map of enrichments is folded into a
 * plain JSON object; an empty/absent map drops the key so the output stays minimal.
 */
export function exportGraphSnapshot(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opts: ExportOptions = {},
): GraphSnapshot {
  const enrichments = enrichmentsRecord(opts.enrichments);
  return {
    version: GRAPH_SNAPSHOT_VERSION,
    ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    ...(opts.root ? { root: opts.root } : {}),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: [...nodes],
    edges: [...edges],
    ...(enrichments ? { enrichments } : {}),
  };
}

function enrichmentsRecord(
  map: ReadonlyMap<NodeAddress, NodeEnrichment> | undefined,
): Record<NodeAddress, NodeEnrichment> | undefined {
  if (!map || map.size === 0) return undefined;
  const record: Record<NodeAddress, NodeEnrichment> = {};
  for (const [address, enrichment] of map) record[address] = enrichment;
  return record;
}
