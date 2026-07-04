import * as fs from "node:fs";
import * as path from "node:path";
import { ARTIFACT_DIR } from "../../core/report/artifact.js";
import { parseGraphSnapshot, type GraphSnapshot } from "../../core/graph/export.js";

// FR-93 — read the persisted `.codegraph/graph.json` back in, so `codegraph serve`
// can hand the board the graph the agent already produced instead of re-scanning.
// The counterpart of FR-91's writeGraphArtifact. Read-only (FR-9). The snapshot was
// written keepHostLocal (a LOCAL host artifact, AD-16), so its docstrings/examples
// survive the round-trip exactly as a live scan would provide them.

export interface LoadedArtifact {
  readonly snapshot: GraphSnapshot;
  /** mtime (ms) of graph.json, for the FR-93 freshness check. */
  readonly mtimeMs: number;
  /** Absolute path read, for logging. */
  readonly path: string;
}

/**
 * Read + parse `<baseDir>/.codegraph/graph.json` if present. Returns null when the
 * artifact is absent, unreadable, or fails snapshot validation — the caller then
 * falls back to a fresh scan. Never throws (a missing/corrupt artifact is a normal,
 * expected state, not an error).
 */
export function readGraphArtifact(baseDir: string): LoadedArtifact | null {
  const file = path.join(baseDir, ARTIFACT_DIR, "graph.json");
  let text: string;
  let mtimeMs: number;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    mtimeMs = stat.mtimeMs;
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null; // absent or unreadable
  }
  const result = parseGraphSnapshot(text);
  if (!result.ok) return null; // corrupt / wrong version — scan instead
  return { snapshot: result.snapshot, mtimeMs, path: file };
}
