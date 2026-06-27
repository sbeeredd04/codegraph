// Open-source benchmark harness (Story 1.2). Run the TS parser over a real
// repo and report how the graph holds up: node/edge counts, coverage, timing.
//
//   npm run bench -- <dir> [<dir> ...]
//
// Run with tsx (resolves the .js->.ts import convention).
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { Project } from "ts-morph";
import { CodeGraph } from "../src/core/graph/graph.js";
import { summarizeGraph } from "../src/core/graph/summary.js";
import { createTypeScriptAdapter } from "../src/adapters/lang/typescript/index.js";
import { resolveImportEdges } from "../src/adapters/lang/typescript/edges.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "coverage", "fixtures"]);

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkTsFiles(full, acc);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

async function benchmark(target: string, wasmDir: string): Promise<void> {
  const adapter = await createTypeScriptAdapter(wasmDir);
  const files = walkTsFiles(target);
  const graph = new CodeGraph();
  let parsed = 0;
  let failed = 0;

  const t0 = performance.now();
  for (const file of files) {
    try {
      const source = fs.readFileSync(file, "utf8");
      const rel = path.relative(target, file);
      const { nodes, edges } = adapter.parseFile(rel, source);
      for (const n of nodes) graph.addNode(n);
      for (const e of edges) graph.addEdge(e);
      parsed += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ! failed: ${path.relative(target, file)} — ${(err as Error).message}`);
    }
  }
  // Accurate import edges via ts-morph (AD-9 two-layer).
  let importEdges = 0;
  try {
    const project = new Project();
    for (const file of files) project.addSourceFileAtPath(file);
    for (const edge of resolveImportEdges(project, target)) {
      graph.addEdge(edge);
      importEdges += 1;
    }
  } catch (err) {
    console.error(`  ! ts-morph import pass failed: ${(err as Error).message}`);
  }

  const ms = Math.round(performance.now() - t0);
  const s = summarizeGraph(graph);

  console.log(`\n=== ${target} ===`);
  console.log(`files:    ${files.length} found, ${parsed} parsed, ${failed} failed`);
  console.log(`coverage: ${files.length ? Math.round((parsed / files.length) * 100) : 0}%`);
  console.log(`nodes:    ${s.nodeCount}  (module ${s.byKind.module}, class ${s.byKind.class}, function ${s.byKind.function}, method ${s.byKind.method})`);
  console.log(`edges:    ${s.edgeCount}  (${s.edgeCount - importEdges} contains, ${importEdges} depends-on)`);
  console.log(`orphans:  ${s.orphanCount}`);
  console.log(`time:     ${ms}ms`);
}

async function main(): Promise<void> {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: npm run bench -- <dir> [<dir> ...]");
    process.exit(1);
  }
  const require = createRequire(import.meta.url);
  const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
  for (const target of targets) {
    await benchmark(path.resolve(target), wasmDir);
  }
}

void main();
