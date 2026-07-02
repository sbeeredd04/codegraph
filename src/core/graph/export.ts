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
import { validateDoc, type Doc, type DocInput } from "../docs/doc.js";
import { validateOverlay, type Overlay } from "../overlays/overlay.js";

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
  /** Agent-authored knowledge docs (Epic 7 / FR-29) — long-form Markdown prose
   * about the repo. Present only when non-empty; the prose companion to the
   * graph (structure) and diagrams (narrative shapes). */
  readonly docs?: readonly Doc[];
  /** Agent-authored knowledge overlays (Epic 19 / FR-37) — notes, marks, and
   * groups pinned to graph identities. The agent's durable memory ABOUT the code
   * (never source bytes), carried so a snapshot replays its annotations offline.
   * Present only when non-empty. */
  readonly overlays?: readonly Overlay[];
}

export interface ExportOptions {
  readonly enrichments?: ReadonlyMap<NodeAddress, NodeEnrichment>;
  readonly diagrams?: readonly Diagram[];
  readonly docs?: readonly Doc[];
  readonly overlays?: readonly Overlay[];
  readonly generatedAt?: string;
  readonly root?: string;
  /**
   * Keep host-local node fields (`doc`, `examples`) in the output. DEFAULT false —
   * the portable/cloud-facing snapshot strips them (AD-14). Set true ONLY for the
   * live LOCAL-plane message (the in-editor webview, `codegraph serve`), which runs
   * on the host where the source already lives, so a node's docstring can drive the
   * FR-60 fallback note. Never set on an exported-to-file or cloud snapshot.
   */
  readonly keepHostLocal?: boolean;
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
  const docs = opts.docs && opts.docs.length ? [...opts.docs] : undefined;
  const overlays = opts.overlays && opts.overlays.length ? [...opts.overlays] : undefined;
  return {
    version: GRAPH_SNAPSHOT_VERSION,
    ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    ...(opts.root ? { root: opts.root } : {}),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    // The portable snapshot is the cloud-facing artifact (AD-14: source-blind).
    // `doc`/`examples` are developer prose/values lifted from source — host-local
    // only — so they are stripped here UNLESS this is the live local-plane message
    // (keepHostLocal), which runs on the host and drives the FR-60 docstring note.
    // Mirrors how the editor root never enters a portable snapshot. Structural fields
    // always pass through.
    nodes: opts.keepHostLocal ? [...nodes] : nodes.map(stripHostLocal),
    edges: [...edges],
    ...(enrichments ? { enrichments } : {}),
    ...(diagrams ? { diagrams } : {}),
    ...(docs ? { docs } : {}),
    ...(overlays ? { overlays } : {}),
  };
}

/** Drop host-local fields (FR-60 `doc`, FR-59 `examples`) so source-/runtime-
 * derived prose and values never reach the source-blind cloud plane (AD-14).
 * Returns the same object when there's nothing to strip, so the common case
 * allocates nothing extra. */
function stripHostLocal(node: GraphNode): GraphNode {
  if (node.doc === undefined && node.examples === undefined) return node;
  const { doc: _doc, examples: _examples, ...rest } = node;
  return rest;
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
  const mutable = snapshot as {
    diagrams?: readonly Diagram[];
    docs?: readonly Doc[];
    overlays?: readonly Overlay[];
  };
  const diagrams = validateSnapshotDiagrams(obj.diagrams);
  if (diagrams) mutable.diagrams = diagrams;
  else delete mutable.diagrams;
  const docs = validateSnapshotDocs(obj.docs);
  if (docs) mutable.docs = docs;
  else delete mutable.docs;
  const overlays = validateSnapshotOverlays(obj.overlays);
  if (overlays) mutable.overlays = overlays;
  else delete mutable.overlays;
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

/** Re-validate the (untrusted) docs array from a parsed snapshot — same tolerance
 * as the diagrams path: drop the malformed, keep the valid, undefined when absent. */
function validateSnapshotDocs(raw: unknown): readonly Doc[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const docs: Doc[] = [];
  for (const entry of raw) {
    const r = validateDoc((entry ?? {}) as DocInput);
    if (r.ok) docs.push(r.doc);
  }
  return docs.length ? docs : undefined;
}

/** Re-validate the (untrusted) overlays array from a parsed snapshot — same
 * tolerance as the diagrams/docs path: drop the malformed, keep the valid,
 * undefined when absent. validateOverlay dispatches on each entry's `kind`. */
function validateSnapshotOverlays(raw: unknown): readonly Overlay[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const overlays: Overlay[] = [];
  for (const entry of raw) {
    const r = validateOverlay(entry);
    if (r.ok) overlays.push(r.overlay);
  }
  return overlays.length ? overlays : undefined;
}
