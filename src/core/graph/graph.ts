import type { GraphNode, GraphEdge, NodeAddress } from "./types.js";

/**
 * The pure, in-memory semantic graph store (spine AD-12: in-memory, derived).
 * Adapter-free and I/O-free (AD-1). A Map-backed store is the seed; the internal
 * representation can later move to graphology behind this same surface (Story 1.3+).
 */
export class CodeGraph {
  private readonly nodes = new Map<NodeAddress, GraphNode>();
  private readonly outbound = new Map<NodeAddress, Set<NodeAddress>>();
  private readonly hasInbound = new Set<NodeAddress>();
  private readonly edges: GraphEdge[] = [];
  private readonly edgeKeys = new Set<string>();

  /** Number of nodes. */
  get order(): number {
    return this.nodes.size;
  }

  /** Number of edges. */
  get size(): number {
    return this.edges.length;
  }

  addNode(node: GraphNode): void {
    this.nodes.set(node.address, node);
  }

  getNode(address: NodeAddress): GraphNode | undefined {
    return this.nodes.get(address);
  }

  /** All nodes, read-only (for projections, summaries, export). */
  allNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  addEdge(edge: GraphEdge): void {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push(edge);

    let outs = this.outbound.get(edge.from);
    if (!outs) {
      outs = new Set();
      this.outbound.set(edge.from, outs);
    }
    outs.add(edge.to);
    this.hasInbound.add(edge.to);
  }

  /** All edges (with type), read-only — for projections and rendering. */
  allEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /** Outbound neighbor addresses of a node (edge targets, even if not yet a node). */
  neighbors(address: NodeAddress): NodeAddress[] {
    return [...(this.outbound.get(address) ?? [])];
  }

  /** Known nodes with no inbound edge — dead-code candidates (FR-12 seed). */
  orphans(): NodeAddress[] {
    const result: NodeAddress[] = [];
    for (const address of this.nodes.keys()) {
      if (!this.hasInbound.has(address)) {
        result.push(address);
      }
    }
    return result;
  }
}
