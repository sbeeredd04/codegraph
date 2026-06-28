// Generate a GraphSnapshot PLUS a sidecar tree of the first-party source files it
// references, so the hosted/static demo can drive the node source-code viewer
// (FR-15) on a real graph WITHOUT shipping third-party source. Source is bundled
// only for first-party samples (we own the code); third-party benchmarks like
// tRPC stay graph-only and the viewer degrades to the signature card.
//
//   npx tsx scripts/gen-sample-with-source.ts <repoRoot> <outFile.json> <outSrcDir>
//
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { bootstrapRepo } from "../src/adapters/lang/bootstrap.js";
import { exportGraphSnapshot } from "../src/core/graph/export.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

const root = process.argv[2];
const outJson = process.argv[3];
const outSrc = process.argv[4];
if (!root || !outJson || !outSrc) {
  throw new Error("usage: tsx scripts/gen-sample-with-source.ts <repoRoot> <outFile.json> <outSrcDir>");
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const { graph, coverage } = await bootstrapRepo(root, wasmDir, {
    python: false,
    // The Next.js app + its vendored core are noise for a self-portrait; everything
    // else (gitignored dirs like node_modules/dist) bootstrap already skips.
    exclude: ["frontend", "__tests__", "tests", "test", "_artifacts"],
  });
  const nodes = graph.allNodes();
  const edges = graph.allEdges();
  const snapshot = exportGraphSnapshot(nodes, edges, {
    root: path.basename(root),
    generatedAt: "2026-06-27T00:00:00.000Z",
  });
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(snapshot));

  // Mirror each referenced file (relative path preserved) into the sidecar so the
  // viewer can fetch `<srcBase>/<location.file>`. Skip anything outside the repo
  // root (defensive: never copy by an absolute path that escapes the tree).
  const files = new Set(nodes.map((n) => n.location.file));
  let copied = 0;
  let bytes = 0;
  for (const rel of files) {
    if (path.isAbsolute(rel) || rel.split(path.sep).includes("..")) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const dest = path.join(outSrc, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
    copied++;
    bytes += fs.statSync(dest).size;
  }

  process.stdout.write(
    JSON.stringify(
      {
        ms: Date.now() - t0,
        coverage,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        filesReferenced: files.size,
        filesCopied: copied,
        srcBytes: bytes,
        jsonBytes: fs.statSync(outJson).size,
      },
      null,
      2,
    ) + "\n",
  );
}

void main();
