// Bridge from the structural graph to enrichment inputs (Epic 4 slice 3): given
// a node address, gather the node plus its dependency neighbourhood (what it
// calls, what calls it) as an EnrichmentContext. Pure (AD-1). This is the single
// source of truth used both when an annotation is WRITTEN (to compute its
// content-hash cache key) and when one is READ back (to look it up) — so the key
// matches on both sides. Structural `contains` edges are excluded: containment
// isn't something a node "calls".

import type { CodeGraph } from "../graph/graph.js";
import type { NodeAddress } from "../graph/types.js";
import { DEPENDENCY_EDGES } from "../graph/reachability.js";
import type { EnrichmentContext } from "./enrichment.js";

/** A node's display name, falling back to the symbol part of its address (or the
 * whole address) when the target isn't itself a known node. */
function nameOf(graph: CodeGraph, address: NodeAddress): string {
  const node = graph.getNode(address);
  if (node) return node.name;
  return address.includes("#") ? (address.split("#").pop() as string) : address;
}

/**
 * Build the {@link EnrichmentContext} for a node: itself, the names of its
 * outbound dependency targets (`calls`), and the names of its inbound dependency
 * sources (`calledBy`). Names are de-duplicated. Returns undefined if the
 * address isn't a known node.
 */
export function buildEnrichmentContext(
  graph: CodeGraph,
  address: NodeAddress,
): EnrichmentContext | undefined {
  const node = graph.getNode(address);
  if (!node) return undefined;

  const calls = new Set<string>();
  const calledBy = new Set<string>();
  for (const e of graph.allEdges()) {
    if (!DEPENDENCY_EDGES.has(e.type)) continue;
    if (e.from === address) calls.add(nameOf(graph, e.to));
    else if (e.to === address) calledBy.add(nameOf(graph, e.from));
  }

  return { node, calls: [...calls], calledBy: [...calledBy] };
}
