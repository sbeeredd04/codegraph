// FR-91 — the persistent graph artifact (codegraph's `graphify-out/`). One command
// scans a repo and writes a durable `.codegraph/` folder that BOTH the human's board
// and the connected AI agent read: a portable `graph.json` (the snapshot) and a
// plain-language `GRAPH_REPORT.md`. This is the handoff surface that makes codegraph
// worth the model's while — the agent checks for this artifact and queries it instead
// of grepping (graphify's fast-path), and the website loads it without a re-scan.
//
// Pure (AD-1): nodes/edges in, an in-memory file map out. No fs, no clock — the
// adapter supplies `generatedAt` and does the actual write. Reuses exportGraphSnapshot
// (the graph.json contract) and buildMarkdownReport (the report), so there is one
// snapshot shape across the extension, the CLI, and this artifact.

import type { GraphNode, GraphEdge } from "../graph/types.js";
import { exportGraphSnapshot, type GraphSnapshot } from "../graph/export.js";
import { buildMarkdownReport } from "./report.js";

/** The folder codegraph writes its artifact into (a dot-dir, so the next scan skips
 *  it — the walker already ignores dot-directories — and it stays out of the way). */
export const ARTIFACT_DIR = ".codegraph";

export interface GraphArtifactFile {
  /** File name within the artifact dir, e.g. `graph.json`. */
  readonly name: string;
  readonly content: string;
}

export interface GraphArtifact {
  readonly snapshot: GraphSnapshot;
  readonly files: readonly GraphArtifactFile[];
}

export interface GraphArtifactOptions {
  /** The repo root, recorded in the snapshot for provenance/display. */
  readonly root?: string;
  /** ISO timestamp, injected by the adapter (the core never reads a clock). */
  readonly generatedAt?: string;
  /**
   * Keep host-local `doc`/`examples`. DEFAULT true: `.codegraph/` is a LOCAL artifact
   * on the host where the source already lives (AD-16), and the agent reading it there
   * benefits from docstrings. Set false only when writing a shareable/cloud artifact.
   */
  readonly keepHostLocal?: boolean;
  /** Cap for the report's "most depended-upon" table. */
  readonly topNodes?: number;
}

/**
 * Build the durable artifact for a scanned graph: the snapshot plus the two files
 * (`graph.json`, `GRAPH_REPORT.md`) the artifact dir holds. The graph.json is pretty-
 * printed so a human (or an agent diffing it) can read it; the report is the same
 * Markdown the extension's "export report" produces.
 */
export function buildGraphArtifact(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opts: GraphArtifactOptions = {},
): GraphArtifact {
  const snapshot = exportGraphSnapshot(nodes, edges, {
    root: opts.root,
    generatedAt: opts.generatedAt,
    keepHostLocal: opts.keepHostLocal ?? true,
  });
  const report = buildMarkdownReport(snapshot, { topNodes: opts.topNodes });
  return {
    snapshot,
    files: [
      { name: "graph.json", content: `${JSON.stringify(snapshot, null, 2)}\n` },
      { name: "GRAPH_REPORT.md", content: report },
    ],
  };
}
