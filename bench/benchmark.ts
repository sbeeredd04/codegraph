// Open-source benchmark harness (Story 1.2). Runs the SAME whole-repo bootstrap
// the extension uses, over a real repo, and reports how the graph holds up.
//
//   npm run bench -- <dir> [<dir> ...]
//
// Run with tsx (resolves the .js->.ts import convention).
import { createRequire } from "node:module";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { summarizeGraph } from "../src/core/graph/summary.js";
import { bootstrapTypeScriptRepo } from "../src/adapters/lang/typescript/bootstrap.js";

async function benchmark(target: string, wasmDir: string): Promise<void> {
  const t0 = performance.now();
  const { graph, coverage } = await bootstrapTypeScriptRepo(target, wasmDir);
  const ms = Math.round(performance.now() - t0);

  const s = summarizeGraph(graph);
  const dependsOn = graph.allEdges().filter((e) => e.type === "depends-on").length;
  const calls = graph.allEdges().filter((e) => e.type === "calls").length;
  const contains = s.edgeCount - dependsOn - calls;
  const pct = coverage.found ? Math.round((coverage.parsed / coverage.found) * 100) : 0;

  console.log(`\n=== ${target} ===`);
  console.log(`files:    ${coverage.found} found, ${coverage.parsed} parsed, ${coverage.failed} failed`);
  console.log(`coverage: ${pct}%`);
  console.log(`nodes:    ${s.nodeCount}  (module ${s.byKind.module}, class ${s.byKind.class}, function ${s.byKind.function}, method ${s.byKind.method})`);
  console.log(`edges:    ${s.edgeCount}  (${contains} contains, ${dependsOn} depends-on, ${calls} calls)`);
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
