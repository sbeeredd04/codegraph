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
 * Default cap on graph.json size (256 MiB). Generous — even a very large repo's snapshot
 * is well under this — but it stops a hostile or corrupt giant file at `.codegraph/
 * graph.json` from being slurped into memory (readFileSync) and `JSON.parse`d, which
 * would OOM the process. Past the cap we return null and the caller rescans (the scan
 * builds the real, correctly-sized graph incrementally).
 */
export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

export interface ReadArtifactOptions {
  /** Override the size cap (mainly for tests). */
  readonly maxBytes?: number;
}

/**
 * Read + parse `<baseDir>/.codegraph/graph.json` if present. Returns null when the
 * artifact is absent, unreadable, larger than the size cap, or fails snapshot
 * validation — the caller then falls back to a fresh scan. Never throws (a missing/
 * corrupt/oversized artifact is a normal, expected state, not an error).
 */
export function readGraphArtifact(
  baseDir: string,
  opts: ReadArtifactOptions = {},
): LoadedArtifact | null {
  const maxBytes = opts.maxBytes ?? MAX_ARTIFACT_BYTES;
  const file = path.join(baseDir, ARTIFACT_DIR, "graph.json");
  let text: string;
  let mtimeMs: number;
  try {
    const stat = fs.statSync(file);
    // Guard the read itself: only a regular file, and not one so large that reading +
    // parsing it would exhaust memory. Check BEFORE readFileSync.
    if (!stat.isFile() || stat.size > maxBytes) return null;
    mtimeMs = stat.mtimeMs;
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null; // absent or unreadable
  }
  const result = parseGraphSnapshot(text);
  if (!result.ok) return null; // corrupt / wrong version — scan instead
  return { snapshot: result.snapshot, mtimeMs, path: file };
}
