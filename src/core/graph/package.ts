// Package / workspace partition (FR-57). A pure, deterministic grouping of graph
// nodes into the packages of a monorepo — `packages/web` vs `packages/server`,
// `apps/*`, or simply the top-level source areas of a flat repo — so a multi-
// package codebase reads as distinct subsystems instead of one undifferentiated
// cloud. Derived ENTIRELY from `location.file` path metadata that already rides
// the snapshot: structural, cloud-safe (AD-14), no source bytes, no fs/network.
// The hard part (boundary inference + stable ordering) is unit-tested here so the
// UI stays a thin shell that renders a legend + filter over the result.

import type { GraphNode } from "./types.js";

/** A single package/workspace the graph partitions into. */
export interface PackageInfo {
  /** Stable, unique id — `packages/web`, `apps/site`, or a bare top-level segment
   *  like `frontend`. Drives the filter value + the per-node lookup. */
  readonly id: string;
  /** Human label — the bare package name (`web`), or the segment for flat repos. */
  readonly label: string;
  /** How many nodes live in this package. */
  readonly count: number;
}

export interface PackagePartition {
  /** Packages ordered most-populated first, ties broken by id (deterministic). */
  readonly packages: readonly PackageInfo[];
  /** Node address → package id, for the detail chip + filter membership. */
  readonly of: ReadonlyMap<string, string>;
}

// Conventional monorepo container directories: the segment AFTER one of these is
// the package name (`packages/<name>/…`). Ordered, but membership is what matters.
const CONTAINER_DIRS = new Set(["packages", "apps", "services", "libs", "modules", "workspaces"]);

/** Repo-relative file path → its package boundary `{id,label}`, or null for a
 *  root-level file with no directory (it belongs to no package). Splits on either
 *  separator so Windows-style paths partition the same as POSIX. */
function packageOfFile(file: string): { id: string; label: string } | null {
  const segs = file.split(/[\\/]/).filter((s) => s.length > 0);
  if (segs.length < 2) return null; // a bare `main.ts` has no enclosing package
  const [head, second] = segs;
  if (CONTAINER_DIRS.has(head) && segs.length >= 3) {
    return { id: `${head}/${second}`, label: second };
  }
  // Flat repo / non-container layout: the top-level directory IS the package area.
  return { id: head, label: head };
}

/**
 * Partition `nodes` into packages by their source path. Nodes with no package
 * boundary (root-level files) are simply omitted from `of` and the counts — the
 * caller treats "no package" as unfiltered. Pure + deterministic: same nodes →
 * identical partition + ordering, so it is safe to recompute on every render.
 */
export function partitionByPackage(nodes: readonly GraphNode[]): PackagePartition {
  const of = new Map<string, string>();
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();

  for (const n of nodes) {
    const pkg = packageOfFile(n.location.file);
    if (!pkg) continue;
    of.set(n.address, pkg.id);
    labels.set(pkg.id, pkg.label);
    counts.set(pkg.id, (counts.get(pkg.id) ?? 0) + 1);
  }

  const packages = [...counts.entries()]
    .map(([id, count]) => ({ id, label: labels.get(id) ?? id, count }))
    .sort((a, b) => (b.count - a.count) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { packages, of };
}
