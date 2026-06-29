// FR-56 — entry-point detection. A reader landing on a large graph wants to know
// "where does this thing start?". Conventional entry files (main.ts / main.py /
// __main__.py / manage.py / a CLI / a web app module), a `main` function, and the
// roots of the dependency graph (modules nothing imports) are strong signals.
//
// Kept pure (AD-1): nodes + edges in, a ranked list out. It reads only the
// relative path metadata + graph structure already present (NOT source bytes), so
// it is cloud-safe. It is a heuristic — it scores and ranks; the surface decides
// how prominently to mark each candidate.

import type { GraphEdge, GraphNode, NodeAddress } from "./types.js";

export interface EntryPoint {
  readonly address: NodeAddress;
  /** Confidence score; higher is a more likely entry point. */
  readonly score: number;
  /** Human-readable justification (e.g. "main.ts · no inbound imports"). */
  readonly reason: string;
}

/** A candidate is reported only at or above this score, keeping precision high. */
const ENTRY_THRESHOLD = 40;

/** Conventional entry filenames → (score, reason), matched on the path basename. */
const FILE_SIGNALS: ReadonlyArray<{ base: string; score: number; reason: string }> = [
  { base: "__main__.py", score: 96, reason: "Python __main__ entry" },
  { base: "main.py", score: 94, reason: "main.py" },
  { base: "main.ts", score: 94, reason: "main.ts" },
  { base: "main.js", score: 94, reason: "main.js" },
  { base: "main.tsx", score: 92, reason: "main.tsx" },
  { base: "manage.py", score: 88, reason: "Django manage.py" },
  { base: "asgi.py", score: 84, reason: "ASGI entry" },
  { base: "wsgi.py", score: 84, reason: "WSGI entry" },
  { base: "app.py", score: 80, reason: "app.py" },
  { base: "cli.py", score: 78, reason: "Python CLI entry" },
  { base: "cli.ts", score: 78, reason: "CLI entry" },
  { base: "server.ts", score: 76, reason: "server entry" },
  { base: "server.js", score: 76, reason: "server entry" },
  { base: "index.ts", score: 64, reason: "index module" },
  { base: "index.js", score: 64, reason: "index module" },
  { base: "index.tsx", score: 62, reason: "index module" },
];

/**
 * Detect and rank a graph's likely entry points. Returns the candidates scoring
 * at or above the threshold, strongest first (ties broken by address for a stable
 * order). An empty array when nothing looks like an entry point.
 */
export function detectEntryPoints(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): readonly EntryPoint[] {
  const { inbound, outbound } = dependsOnDegrees(edges);
  const found: EntryPoint[] = [];

  for (const node of nodes) {
    const candidate =
      node.kind === "module"
        ? scoreModule(node, inbound.get(node.address) ?? 0, outbound.get(node.address) ?? 0)
        : scoreMainCallable(node);
    if (candidate && candidate.score >= ENTRY_THRESHOLD) {
      found.push({ address: node.address, ...candidate });
    }
  }

  return found.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

function scoreModule(
  node: GraphNode,
  inbound: number,
  outbound: number,
): { score: number; reason: string } | null {
  const base = basename(node.location.file).toLowerCase();
  const file = FILE_SIGNALS.find((s) => s.base === base);
  const reasons: string[] = [];
  let score = 0;

  if (file) {
    score = file.score;
    reasons.push(file.reason);
  }

  // A dependency root — nothing imports it, yet it pulls in many modules — is the
  // shape of a real entry point. It boosts a filename match and can stand alone.
  const isRoot = inbound === 0 && outbound >= 3;
  if (isRoot) {
    score += file ? 6 : 40;
    reasons.push("no inbound imports");
  } else if (file && inbound > 0) {
    // A conventionally-named file that IS imported is more likely a library
    // module than the program's entry — demote it.
    score -= 20;
  }

  return reasons.length ? { score, reason: reasons.join(" · ") } : null;
}

/** A function or method literally named `main` is a classic program entry. */
function scoreMainCallable(node: GraphNode): { score: number; reason: string } | null {
  if (node.kind !== "function" && node.kind !== "method") return null;
  return node.name.toLowerCase() === "main" ? { score: 58, reason: "main function" } : null;
}

/** Count inbound and outbound `depends-on` (import) edges per node address. */
function dependsOnDegrees(edges: readonly GraphEdge[]): {
  inbound: Map<NodeAddress, number>;
  outbound: Map<NodeAddress, number>;
} {
  const inbound = new Map<NodeAddress, number>();
  const outbound = new Map<NodeAddress, number>();
  for (const e of edges) {
    if (e.type !== "depends-on") continue;
    outbound.set(e.from, (outbound.get(e.from) ?? 0) + 1);
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
  }
  return { inbound, outbound };
}

function basename(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] || file;
}
