// FR-69 companion — a plausible "previous version" of the live graph so the Diff lens
// has a REALISTIC delta to show on the source-blind web plane, which has no live
// re-index channel (only the VS Code extension re-scans / diffs a git ref). Without
// this the only way to trigger a diff on the website is switching to an UNRELATED
// dataset, which reads as "everything added / everything removed" — the whole board
// turns one colour and the feature looks broken. `sampleBaseline` instead perturbs the
// current graph into a believable earlier snapshot (a few added / removed / changed /
// moved), so computeGraphDiff(sampleBaseline(g), g) lights up a real +/−/~/→ mix on the
// same repo, tinting nodes on both surfaces exactly as a real re-scan would.
//
// Deterministic (stable demo + e2e — picks by sorted address / degree, no randomness).
// Pure + view-only (FR-9, AD-14): graph identities + kinds only, never source bytes,
// never a host path. Mirrors src/core/graph/diff.ts semantics: a `changed` node keeps
// its address but its OUTBOUND edge-set differs; a `moved` node is unmatched by address
// yet matches by name + preserved neighbours (score ≥ 3).

import type { GraphEdge, GraphNode } from "@core/graph/types";
import type { GraphSnapshotInput } from "./graph-diff";

// Small, realistic counts so the delta reads as "what changed since last time".
const N_ADDED = 3; // present now, absent in the baseline
const N_REMOVED = 2; // in the baseline, gone now (panel-only — off the board)
const N_CHANGED = 4; // same node, its call/dependency edges shifted
const N_MOVED = 1; // relocated to a new file (identity survives via matching)

/** A plausible prior path for a moved file, in the same folder so it reads as a move. */
function legacyFile(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? `legacy/${file}` : `${file.slice(0, slash)}/legacy/${file.slice(slash + 1)}`;
}

/** Swap the file segment of an address for its legacy path (addresses embed the file). */
function legacyAddress(addr: string, file: string, oldFile: string): string {
  return addr.includes(file) ? addr.replace(file, oldFile) : `${addr}~legacy`;
}

export function sampleBaseline(current: GraphSnapshotInput): GraphSnapshotInput {
  const byAddress = [...current.nodes].sort((a, b) => a.address.localeCompare(b.address));
  const outDegree = new Map<string, number>();
  for (const e of current.edges) outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);

  const used = new Set<string>();
  const pick = (order: readonly GraphNode[], ok: (n: GraphNode) => boolean, k: number): GraphNode[] => {
    const out: GraphNode[] = [];
    for (const n of order) {
      if (out.length >= k) break;
      if (used.has(n.address) || !ok(n)) continue;
      used.add(n.address);
      out.push(n);
    }
    return out;
  };

  // "Added" = leaf nodes (0 outbound) dropped from the baseline — leaves can never be
  // mistaken for a move (no neighbours to match on), so they read cleanly as added.
  const addedPick = pick(byAddress, (n) => (outDegree.get(n.address) ?? 0) === 0, N_ADDED);
  // "Moved" = the highest-degree nodes, so the preserved-neighbour jaccard stays strong
  // and the diff matches them as moved rather than delete+create.
  const byDegree = [...current.nodes].sort(
    (a, b) => (outDegree.get(b.address) ?? 0) - (outDegree.get(a.address) ?? 0) || a.address.localeCompare(b.address),
  );
  const movedPick = pick(byDegree, (n) => (outDegree.get(n.address) ?? 0) >= 2, N_MOVED);
  // "Changed" = any remaining node with outbound edges; we drop exactly one of them.
  const changedPick = pick(byAddress, (n) => (outDegree.get(n.address) ?? 0) >= 1, N_CHANGED);

  const dropped = new Set(addedPick.map((n) => n.address));
  const changed = new Set(changedPick.map((n) => n.address));
  const movedTo = new Map<string, { address: string; file: string }>();
  for (const n of movedPick) {
    const oldFile = legacyFile(n.location.file);
    movedTo.set(n.address, { address: legacyAddress(n.address, n.location.file, oldFile), file: oldFile });
  }

  // Baseline nodes: drop the "added" set, re-address the "moved" set, keep the rest.
  const baseNodes: GraphNode[] = [];
  for (const n of current.nodes) {
    if (dropped.has(n.address)) continue;
    const moved = movedTo.get(n.address);
    if (moved) {
      baseNodes.push({ ...n, address: moved.address, location: { ...n.location, file: moved.file } });
      continue;
    }
    baseNodes.push(n);
  }
  // Fabricate the "removed" nodes — present in the baseline, gone from the live graph.
  for (let i = 0; i < N_REMOVED; i++) {
    baseNodes.push({
      address: `ts:legacy/removed-${i}.ts#deprecatedHelper${i}`,
      kind: "function",
      name: `deprecatedHelper${i}`,
      location: { file: `legacy/removed-${i}.ts`, line: 0, character: 0 },
    });
  }

  const present = new Set(baseNodes.map((n) => n.address));
  const omitted = new Set<string>();
  const baseEdges: GraphEdge[] = [];
  for (const e of current.edges) {
    if (dropped.has(e.from) || dropped.has(e.to)) continue; // an added node's edges don't exist yet
    // Omit exactly ONE outbound edge per changed node so its edge-set differs → changed.
    if (changed.has(e.from) && !omitted.has(e.from)) {
      omitted.add(e.from);
      continue;
    }
    const from = movedTo.get(e.from)?.address ?? e.from;
    const to = movedTo.get(e.to)?.address ?? e.to;
    if (!present.has(from) || !present.has(to)) continue;
    baseEdges.push({ ...e, from, to });
  }

  return { nodes: baseNodes, edges: baseEdges };
}
