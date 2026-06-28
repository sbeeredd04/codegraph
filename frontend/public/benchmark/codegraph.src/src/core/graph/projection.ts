import type { GraphNode, GraphEdge } from "./types.js";

// Projections (FR-4): filtered views of the ONE model. Each projection is just a
// filter over the canonical nodes/edges — no separate ingestion (spine paradigm).
export type ProjectionKind = "full" | "dependency" | "call" | "structure";

export interface Projection {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export function projectGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  kind: ProjectionKind,
): Projection {
  switch (kind) {
    case "dependency":
      return {
        nodes: nodes.filter((n) => n.kind === "module"),
        edges: edges.filter((e) => e.type === "depends-on"),
      };
    case "call":
      return {
        nodes: nodes.filter((n) => n.kind === "function" || n.kind === "method"),
        edges: edges.filter((e) => e.type === "calls"),
      };
    case "structure":
      return { nodes, edges: edges.filter((e) => e.type === "contains") };
    case "full":
    default:
      return { nodes, edges };
  }
}
