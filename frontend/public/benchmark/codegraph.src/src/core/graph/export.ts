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
import { validateDiagram, type Diagram, type DiagramInput } from "../diagrams/diagram.js";

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
  /** Agent-authored knowledge diagrams (Epic 7) — present only when non-empty. The
   * narrative companion to the structural graph, carried so a snapshot is a
   * complete, self-contained picture of the repo a viewer can render offline. */
  readonly diagrams?: readonly Diagram[];
}

export interface ExportOptions {
  readonly enrichments?: ReadonlyMap<NodeAddress, NodeEnrichment>;
  readonly diagrams?: readonly Diagram[];
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
  const diagrams = opts.diagrams && opts.diagrams.length ? [...opts.diagrams] : undefined;
  return {
    version: GRAPH_SNAPSHOT_VERSION,
    ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    ...(opts.root ? { root: opts.root } : {}),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: [...nodes],
    edges: [...edges],
    ...(enrichments ? { enrichments } : {}),
    ...(diagrams ? { diagrams } : {}),
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

/** The import counterpart of exportGraphSnapshot. */
export type ParseSnapshotResult =
  | { readonly ok: true; readonly snapshot: GraphSnapshot }
  | { readonly ok: false; readonly error: string };

/**
 * Parse and validate snapshot text from an untrusted source (a file the user
 * picked). Returns a tagged result rather than throwing, so the viewer can show
 * a calm message instead of a blank page. Validation is deliberately shallow —
 * it guards the envelope (valid JSON, an object, a supported version, the two
 * required arrays); it trusts the node/edge element shapes, which are our own.
 */
export function parseGraphSnapshot(text: string): ParseSnapshotResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "A snapshot must be a JSON object." };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== GRAPH_SNAPSHOT_VERSION) {
    return {
      ok: false,
      error: `Unsupported snapshot version (this viewer reads version ${GRAPH_SNAPSHOT_VERSION}).`,
    };
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    return { ok: false, error: "This snapshot is missing its nodes or edges." };
  }
  // Diagrams carry agent-written (untrusted) Mermaid; a snapshot file is also
  // user-supplied. Re-validate each through the same guard the write path uses,
  // dropping any malformed one rather than failing the whole snapshot.
  const snapshot = { ...(obj as unknown as GraphSnapshot) };
  const mutable = snapshot as { diagrams?: readonly Diagram[] };
  const diagrams = validateSnapshotDiagrams(obj.diagrams);
  if (diagrams) mutable.diagrams = diagrams;
  else delete mutable.diagrams;
  return { ok: true, snapshot };
}

/** Re-validate the (untrusted) diagrams array from a parsed snapshot, mirroring
 * parseDiagramSet's tolerance: drop the malformed, keep the valid, undefined when
 * the array is absent or empties out. */
function validateSnapshotDiagrams(raw: unknown): readonly Diagram[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const diagrams: Diagram[] = [];
  for (const entry of raw) {
    const r = validateDiagram((entry ?? {}) as DiagramInput);
    if (r.ok) diagrams.push(r.diagram);
  }
  return diagrams.length ? diagrams : undefined;
}
