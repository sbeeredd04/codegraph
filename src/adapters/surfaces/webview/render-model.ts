import type { GraphNode, GraphEdge, NodeKind, EdgeType, GraphDelta } from "../../../core/graph/types.js";
import type { RankedChange } from "../../../core/graph/change-feed.js";
import type { NodeEnrichment } from "../../../core/semantic/enrichment.js";
import type { DiagramPanelModel } from "./diagram-view.js";
import type { SearchableNode } from "../../../core/search/node-search.js";

// Design language (PRD §8.5): dark IDE aesthetic, nodes colored by semantic kind.
// A restrained, legible palette — modules anchor, leaves recede.
export const KIND_COLORS: Record<NodeKind, string> = {
  module: "#6aa3ff", // blue — containers
  class: "#b08cff", // violet — types
  function: "#5fd39a", // green — behavior
  method: "#5cc8e6", // cyan — behavior on a type
  workflow: "#f1b45a", // amber — flows
};

const KIND_SIZE: Record<NodeKind, number> = {
  module: 10,
  class: 8,
  function: 5,
  method: 4,
  workflow: 9,
};

// Change-diff overlay (FR-7): recolor changed nodes by change type.
export type ChangeKind = "added" | "changed" | "moved";
export const CHANGE_COLORS: Record<ChangeKind, string> = {
  added: "#3fb950", // green
  changed: "#e3b341", // amber
  moved: "#a371f7", // violet
};

export interface DeltaCounts {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly moved: number;
}

/** Map a GraphDelta to per-node change kinds (removed nodes aren't in the new graph). */
export function changesFromDelta(delta: GraphDelta): Map<string, ChangeKind> {
  const m = new Map<string, ChangeKind>();
  for (const n of delta.added) m.set(n.address, "added");
  for (const c of delta.changed) m.set(c.address, "changed");
  for (const mv of delta.movedRenamed) m.set(mv.to, "moved");
  return m;
}

export function deltaCounts(delta: GraphDelta): DeltaCounts {
  return {
    added: delta.added.length,
    removed: delta.removed.length,
    changed: delta.changed.length,
    moved: delta.movedRenamed.length,
  };
}

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
  readonly change?: ChangeKind;
  /** The agent's annotation for this node, if one was written (Epic 4). */
  readonly enrichment?: NodeEnrichment;
  /** No inbound references anywhere in the graph — a dead-code candidate (FR-12, Epic 5). */
  readonly orphan?: boolean;
}

/**
 * Addresses with no inbound edge of any kind — dead-code candidates (FR-12).
 * Mirrors CodeGraph.orphans for the render layer's node/edge arrays; compute it
 * from the FULL graph (not a projection) so orphan status is projection-stable.
 */
export function findOrphanAddresses(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Set<string> {
  const hasInbound = new Set(edges.map((e) => e.to));
  const orphans = new Set<string>();
  for (const n of nodes) if (!hasInbound.has(n.address)) orphans.add(n.address);
  return orphans;
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
  readonly delta?: DeltaCounts;
  readonly feed?: readonly RankedChange[];
  /** How many nodes in this view are orphans — drives the overlay toggle (FR-12). */
  readonly orphanCount: number;
}

/** Versioned host->webview message (spine: host<->webview envelope). The diagram
 * panel rides alongside the graph payload (it is projection-independent, so it is
 * not part of RenderModel) — an optional field older webviews simply ignore. */
export interface RenderMessage {
  readonly type: "render";
  readonly version: 1;
  readonly payload: RenderModel;
  readonly diagrams?: DiagramPanelModel;
  /** The full node set (every projection), as lightweight {address,name,kind} rows
   * for the ⌘K command palette's fuzzy search. Projection-independent like diagrams,
   * so it rides alongside the payload; older webviews simply ignore it. */
  readonly allNodes?: readonly SearchableNode[];
  /** The full edge set (every projection), so the trace-path lens can compute a
   * route over the whole graph regardless of the active view (PM-backlog #3).
   * Projection-independent like allNodes; older webviews simply ignore it. */
  readonly allEdges?: readonly GraphEdge[];
}

/**
 * Pure transform: canonical graph -> a Sigma-ready render model. Initial layout
 * is a deterministic circle (real layout via elk/forceatlas is a later story).
 * Edges with an unknown endpoint are dropped so Sigma never references a missing node.
 */
export function buildRenderModel(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  changes?: ReadonlyMap<string, ChangeKind>,
  delta?: DeltaCounts,
  feed?: readonly RankedChange[],
  enrichments?: ReadonlyMap<string, NodeEnrichment>,
  orphans?: ReadonlySet<string>,
): RenderModel {
  const known = new Set(nodes.map((n) => n.address));
  const n = Math.max(nodes.length, 1);

  const renderNodes: RenderNode[] = nodes.map((node, i) => {
    const change = changes?.get(node.address);
    const enrichment = enrichments?.get(node.address);
    const orphan = orphans?.has(node.address);
    return {
      id: node.address,
      label: node.name,
      kind: node.kind,
      // Changed nodes recolor by change kind and grow slightly (the diff overlay).
      color: change ? CHANGE_COLORS[change] : KIND_COLORS[node.kind],
      size: change ? KIND_SIZE[node.kind] * 1.5 : KIND_SIZE[node.kind],
      x: Math.cos((2 * Math.PI * i) / n),
      y: Math.sin((2 * Math.PI * i) / n),
      file: node.location.file,
      line: node.location.line,
      change,
      ...(enrichment ? { enrichment } : {}),
      ...(orphan ? { orphan: true } : {}),
    };
  });

  const renderEdges: RenderEdge[] = edges
    .filter((e) => known.has(e.from) && known.has(e.to))
    .map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: e.type }));

  const orphanCount = renderNodes.reduce((sum, node) => sum + (node.orphan ? 1 : 0), 0);
  return { nodes: renderNodes, edges: renderEdges, delta, feed, orphanCount };
}
