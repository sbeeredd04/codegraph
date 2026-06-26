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
  private edgeCount = 0;

  /** Number of nodes. */
  get order(): number {
    return this.nodes.size;
  }

  /** Number of edges. */
  get size(): number {
    return this.edgeCount;
  }

  addNode(node: GraphNode): void {
    this.nodes.set(node.address, node);
  }

  getNode(address: NodeAddress): GraphNode | undefined {
    return this.nodes.get(address);
  }

  addEdge(edge: GraphEdge): void {
    let outs = this.outbound.get(edge.from);
    if (!outs) {
      outs = new Set();
      this.outbound.set(edge.from, outs);
    }
    if (!outs.has(edge.to)) {
      outs.add(edge.to);
      this.edgeCount += 1;
    }
    this.hasInbound.add(edge.to);
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
