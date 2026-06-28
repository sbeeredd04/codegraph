// Node annotations (Epic 4 slice 3): the read/write bridge that lets the
// connected agent's understanding live on the graph. The agent WRITES an
// enrichment for a node (via the MCP annotate_node tool); the board and
// describe_node READ it back. Both sides go through the same content-hash key
// (buildEnrichmentContext -> enrichmentKey), so an annotation survives a node
// move/rename but goes stale when the node's signature or call set changes — the
// "no re-spend, self-correcting" guarantee. Pure orchestration: the cache (disk,
// in-memory, …) is injected, keeping I/O at the adapter boundary (AD-1).

import type { CodeGraph } from "../graph/graph.js";
import type { NodeAddress } from "../graph/types.js";
import type { EnrichmentCache, NodeEnrichment } from "./enrichment.js";
import { enrichmentKey } from "./enrichment.js";
import { buildEnrichmentContext } from "./context.js";

export interface NodeAnnotations {
  /** The enrichment stored for the node at `address`, if the node exists and one was written. */
  get(address: NodeAddress): Promise<NodeEnrichment | undefined>;
  /** Store an enrichment for the node at `address`. Returns false if the address is unknown. */
  set(address: NodeAddress, enrichment: NodeEnrichment): Promise<boolean>;
}

/**
 * Wire a {@link NodeAnnotations} over a live graph accessor and an enrichment
 * cache. The graph is read on every call so annotations track the latest scan.
 */
export function createNodeAnnotations(
  getGraph: () => CodeGraph,
  cache: EnrichmentCache,
): NodeAnnotations {
  return {
    get: async (address) => {
      const ctx = buildEnrichmentContext(getGraph(), address);
      if (!ctx) return undefined;
      return (await cache.get(enrichmentKey(ctx))) ?? undefined;
    },
    set: async (address, enrichment) => {
      const ctx = buildEnrichmentContext(getGraph(), address);
      if (!ctx) return false;
      await cache.set(enrichmentKey(ctx), enrichment);
      return true;
    },
  };
}
