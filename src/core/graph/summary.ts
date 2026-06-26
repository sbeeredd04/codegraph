import type { CodeGraph } from "./graph.js";
import type { NodeKind } from "./types.js";

export interface GraphSummary {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly byKind: Record<NodeKind, number>;
  readonly orphanCount: number;
}

const KINDS: readonly NodeKind[] = ["module", "class", "function", "method", "workflow"];

/** Pure rollup of a graph's shape — used by the benchmark harness and the UI. */
export function summarizeGraph(graph: CodeGraph): GraphSummary {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<NodeKind, number>;
  for (const node of graph.allNodes()) {
    byKind[node.kind] += 1;
  }
  return {
    nodeCount: graph.order,
    edgeCount: graph.size,
    byKind,
    orphanCount: graph.orphans().length,
  };
}
