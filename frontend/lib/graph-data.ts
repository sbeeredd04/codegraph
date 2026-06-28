// Data layer for the unified frontend. Reuses the framework-agnostic core's
// GraphSnapshot type (type-only import — erased at runtime, the whole point of
// the hexagonal core) so the Next.js app and the extension speak the exact same
// shape. Runtime pure functions (buildRenderModel, buildKnowledgeIndex, …) will
// be wired in the same way as components land.
import type { GraphSnapshot } from "@core/graph/export";
import type { GraphNode, NodeKind } from "@core/graph/types";

export type { GraphSnapshot, GraphNode, NodeKind };

/** codegraph's semantic kind palette — kept in sync with src/.../render-model.ts. */
export const KIND_COLORS: Record<NodeKind, string> = {
  module: "#6aa3ff",
  class: "#b08cff",
  function: "#5fd39a",
  method: "#5cc8e6",
  workflow: "#f1b45a",
};

export interface PackageStat {
  readonly name: string;
  readonly count: number;
}

export interface GraphStats {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byEdgeType: Readonly<Record<string, number>>;
  readonly packages: readonly PackageStat[];
}

/** Fetch a snapshot JSON (e.g. /benchmark/trpc.json) and parse it. */
export async function loadSnapshot(url: string): Promise<GraphSnapshot> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load snapshot (${res.status})`);
  return (await res.json()) as GraphSnapshot;
}

/** First path segment after `packages/`, else the first segment — the monorepo bucket. */
function packageOf(node: GraphNode): string {
  const file = node.location.file;
  const pkg = /(?:^|\/)packages\/([^/]+)\//.exec(file);
  if (pkg) return pkg[1];
  const seg = file.split("/")[0];
  return seg && seg.includes(".") ? "(root)" : (seg ?? "(root)");
}

export function computeStats(snap: GraphSnapshot): GraphStats {
  const byKind: Record<string, number> = {};
  for (const n of snap.nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;

  const byEdgeType: Record<string, number> = {};
  for (const e of snap.edges) byEdgeType[e.type] = (byEdgeType[e.type] ?? 0) + 1;

  const pkgCounts: Record<string, number> = {};
  for (const n of snap.nodes) {
    const p = packageOf(n);
    pkgCounts[p] = (pkgCounts[p] ?? 0) + 1;
  }
  const packages = Object.entries(pkgCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    nodeCount: snap.nodeCount,
    edgeCount: snap.edgeCount,
    byKind,
    byEdgeType,
    packages,
  };
}
