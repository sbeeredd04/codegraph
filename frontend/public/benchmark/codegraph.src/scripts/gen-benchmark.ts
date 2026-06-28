// Generate a REAL benchmark GraphSnapshot from an external repo (e.g. the tRPC
// monorepo), so the frontend is built and evaluated against hundreds of real
// nodes — not a tiny verification fixture. TS-only by default to skip Pyright.
//
//   npx tsx scripts/gen-benchmark.ts <repoRoot> <outFile.json>
//
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { bootstrapRepo } from "../src/adapters/lang/bootstrap.js";
import { exportGraphSnapshot } from "../src/core/graph/export.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

const root = process.argv[2];
const out = process.argv[3];
if (!root || !out) {
  throw new Error("usage: tsx scripts/gen-benchmark.ts <repoRoot> <outFile>");
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const { graph, coverage } = await bootstrapRepo(root, wasmDir, {
    python: false,
    exclude: ["examples", "www", "scripts", "_artifacts", "__tests__", "tests", "test"],
  });
  const nodes = graph.allNodes();
  const edges = graph.allEdges();
  const snapshot = exportGraphSnapshot(nodes, edges, {
    root: path.basename(root),
    generatedAt: "2026-06-27T00:00:00.000Z",
  });
  fs.writeFileSync(out, JSON.stringify(snapshot));

  // Breakdown by kind + by top-level package (address prefix) for sanity.
  const byKind: Record<string, number> = {};
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const byEdge: Record<string, number> = {};
  for (const e of edges) byEdge[e.type] = (byEdge[e.type] ?? 0) + 1;
  const byPkg: Record<string, number> = {};
  for (const n of nodes) {
    const m = /packages\/([^/]+)\//.exec(n.location.file);
    const pkg = m ? m[1] : "(root)";
    byPkg[pkg] = (byPkg[pkg] ?? 0) + 1;
  }

  process.stdout.write(
    JSON.stringify(
      {
        ms: Date.now() - t0,
        coverage,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        byKind,
        byEdge,
        byPkg,
        bytes: fs.statSync(out).size,
      },
      null,
      2,
    ) + "\n",
  );
}

void main();
