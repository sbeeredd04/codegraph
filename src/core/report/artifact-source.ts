// FR-93 — where should `codegraph serve` get its graph? Either the persisted
// `.codegraph/graph.json` (the artifact the agent already produced, no re-scan) or a
// fresh scan. This is the pure decision: given what's available, the flags, and the
// two timestamps, pick a source and say why. The CLI does the fs reads and the scan;
// this just decides, so the policy is testable without a filesystem.
//
// Pure (AD-1): timestamps + booleans in, a decision out. No fs, no clock.

export type GraphSourceMode = "artifact" | "scan";

export interface GraphSourceInputs {
  /** A readable, parseable `.codegraph/graph.json` was found. */
  readonly artifactAvailable: boolean;
  /** `--from-artifact`: pin the persisted graph, even if it looks stale. */
  readonly forceArtifact?: boolean;
  /** `--rescan`: ignore any artifact and scan fresh. */
  readonly forceRescan?: boolean;
  /** mtime (ms) of the artifact file, when one was found. */
  readonly artifactMtimeMs?: number;
  /** Newest mtime (ms) among the repo's source files, when computed. */
  readonly newestSourceMtimeMs?: number;
}

export interface GraphSourceDecision {
  readonly mode: GraphSourceMode;
  /** The artifact is older than the newest source file (only meaningful when both
   *  timestamps are known). Reported even when it doesn't change the mode, so the
   *  CLI can warn under `--from-artifact`. */
  readonly stale: boolean;
  /** One-line, human-readable rationale for the CLI log. */
  readonly reason: string;
}

/** The artifact predates the newest source file — so it may not reflect the tree.
 *  Undefined timestamps mean "can't tell", which we treat as NOT stale (we don't
 *  rescan on missing information). */
function isStale(i: GraphSourceInputs): boolean {
  return (
    i.artifactMtimeMs !== undefined &&
    i.newestSourceMtimeMs !== undefined &&
    i.newestSourceMtimeMs > i.artifactMtimeMs
  );
}

/**
 * Decide whether to serve the persisted artifact or scan fresh.
 *
 * Precedence: `--rescan` wins outright; then `--from-artifact` pins the artifact
 * (falling back to a scan only if there isn't one); otherwise the default prefers a
 * FRESH artifact and auto-rescans when it's missing or stale, so the board is never
 * wrong by default.
 */
export function decideGraphSource(i: GraphSourceInputs): GraphSourceDecision {
  const stale = isStale(i);

  if (i.forceRescan) {
    return { mode: "scan", stale, reason: "rescan requested — scanning fresh" };
  }

  if (i.forceArtifact) {
    if (i.artifactAvailable) {
      return {
        mode: "artifact",
        stale,
        reason: stale
          ? "using .codegraph/graph.json (--from-artifact) — note: it looks older than the source"
          : "using .codegraph/graph.json (--from-artifact)",
      };
    }
    return { mode: "scan", stale, reason: "no readable .codegraph/graph.json to load — scanning" };
  }

  if (!i.artifactAvailable) {
    return { mode: "scan", stale, reason: "no .codegraph/graph.json — scanning" };
  }
  if (stale) {
    return { mode: "scan", stale, reason: ".codegraph/graph.json is older than the source — rescanning" };
  }
  return {
    mode: "artifact",
    stale,
    reason: "loaded .codegraph/graph.json — skipped the scan",
  };
}
