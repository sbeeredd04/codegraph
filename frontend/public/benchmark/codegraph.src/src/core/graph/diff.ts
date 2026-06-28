import type { CodeGraph } from "./graph.js";
import type { GraphDelta, GraphNode, NodeAddress } from "./types.js";

// GraphDelta diff (AD-6/AD-7): compare two snapshots into added/removed/changed/
// movedRenamed. Identity survives rename+move via heuristic matching so a
// refactor doesn't read as delete+create; low-confidence matches fall back to
// delete+create. Pure — operates on the in-memory graph only.

/** The address minus its last name component: the file (functions) or file#Class (methods). */
function container(addr: NodeAddress): string {
  const hash = addr.indexOf("#");
  if (hash === -1) return addr;
  const rest = addr.slice(hash + 1);
  const dot = rest.lastIndexOf(".");
  return dot === -1 ? addr.slice(0, hash) : addr.slice(0, hash + 1 + dot);
}

function outboundKeys(graph: CodeGraph): Map<NodeAddress, Set<string>> {
  const map = new Map<NodeAddress, Set<string>>();
  for (const edge of graph.allEdges()) {
    const set = map.get(edge.from) ?? new Set<string>();
    set.add(`${edge.to}|${edge.type}`);
    map.set(edge.from, set);
  }
  return map;
}

function setEq(a: Set<string> | undefined, b: Set<string> | undefined): boolean {
  const A = a ?? new Set<string>();
  const B = b ?? new Set<string>();
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** Similarity of a removed-candidate to an added-candidate (0–6). */
function matchScore(before: CodeGraph, after: CodeGraph, b: GraphNode, a: GraphNode): number {
  const name = b.name === a.name ? 2 : 0;
  const cont = container(b.address) === container(a.address) ? 2 : 0;
  const neigh = jaccard(before.neighbors(b.address), after.neighbors(a.address)) * 2;
  return name + cont + neigh;
}

export function diffGraphs(before: CodeGraph, after: CodeGraph, threshold = 3): GraphDelta {
  const beforeNodes = new Map(before.allNodes().map((n) => [n.address, n]));
  const afterNodes = new Map(after.allNodes().map((n) => [n.address, n]));
  const beforeOut = outboundKeys(before);
  const afterOut = outboundKeys(after);

  const added: GraphNode[] = [];
  const removed: NodeAddress[] = [];
  const changed: { address: NodeAddress; before: GraphNode; after: GraphNode }[] = [];
  const movedRenamed: { address: NodeAddress; from: NodeAddress; to: NodeAddress }[] = [];

  // Address-matched nodes: a structural (edge-set) change makes a `changed` entry.
  for (const [addr, bn] of beforeNodes) {
    const an = afterNodes.get(addr);
    if (an && !setEq(beforeOut.get(addr), afterOut.get(addr))) {
      changed.push({ address: addr, before: bn, after: an });
    }
  }

  const unmatchedBefore = [...beforeNodes.keys()].filter((a) => !afterNodes.has(a));
  const unmatchedAfter = new Set([...afterNodes.keys()].filter((a) => !beforeNodes.has(a)));

  for (const bAddr of unmatchedBefore) {
    const bn = beforeNodes.get(bAddr) as GraphNode;
    let best: NodeAddress | undefined;
    let bestScore = 0;
    for (const aAddr of unmatchedAfter) {
      const an = afterNodes.get(aAddr) as GraphNode;
      if (an.kind !== bn.kind) continue;
      const s = matchScore(before, after, bn, an);
      if (s > bestScore) {
        bestScore = s;
        best = aAddr;
      }
    }
    if (best && bestScore >= threshold) {
      movedRenamed.push({ address: best, from: bAddr, to: best });
      unmatchedAfter.delete(best);
    } else {
      removed.push(bAddr); // low-confidence -> delete + create
    }
  }

  for (const aAddr of unmatchedAfter) added.push(afterNodes.get(aAddr) as GraphNode);

  return { added, removed, changed, movedRenamed };
}
