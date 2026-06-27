import type { GraphNode, GraphEdge, NodeKind, EdgeType } from "../../../core/graph/types.js";

// Design language (PRD §8.5): dark IDE aesthetic, nodes colored by semantic kind.
// A restrained, legible palette — modules anchor, leaves recede.
export const KIND_COLORS: Record<NodeKind, string> = {
  module: "#7aa2f7", // blue — containers
  class: "#bb9af7", // violet — types
  function: "#9ece6a", // green — behavior
  method: "#7dcfff", // cyan — behavior on a type
  workflow: "#e0af68", // amber — flows
};

const KIND_SIZE: Record<NodeKind, number> = {
  module: 10,
  class: 8,
  function: 5,
  method: 4,
  workflow: 9,
};

export interface RenderNode {
  readonly id: string;
  readonly label: string;
  readonly kind: NodeKind;
  readonly color: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly file: string;
  readonly line: number;
}

export interface RenderEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: EdgeType;
}

export interface RenderModel {
  readonly nodes: readonly RenderNode[];
  readonly edges: readonly RenderEdge[];
}

/** Versioned host->webview message (spine: host<->webview envelope). */
export interface RenderMessage {
  readonly type: "render";
  readonly version: 1;
  readonly payload: RenderModel;
}

/**
 * Pure transform: canonical graph -> a Sigma-ready render model. Initial layout
 * is a deterministic circle (real layout via elk/forceatlas is a later story).
 * Edges with an unknown endpoint are dropped so Sigma never references a missing node.
 */
export function buildRenderModel(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): RenderModel {
  const known = new Set(nodes.map((n) => n.address));
  const n = Math.max(nodes.length, 1);

  const renderNodes: RenderNode[] = nodes.map((node, i) => ({
    id: node.address,
    label: node.name,
    kind: node.kind,
    color: KIND_COLORS[node.kind],
    size: KIND_SIZE[node.kind],
    x: Math.cos((2 * Math.PI * i) / n),
    y: Math.sin((2 * Math.PI * i) / n),
    file: node.location.file,
    line: node.location.line,
  }));

  const renderEdges: RenderEdge[] = edges
    .filter((e) => known.has(e.from) && known.has(e.to))
    .map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: e.type }));

  return { nodes: renderNodes, edges: renderEdges };
}
