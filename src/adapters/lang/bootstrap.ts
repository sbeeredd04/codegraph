import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { CodeGraph } from "../../core/graph/graph.js";
import type { LanguageAdapter } from "../../core/ports.js";
import { createTypeScriptAdapter } from "./typescript/index.js";
import { createPythonAdapter } from "./python/index.js";
import { resolveImportEdges, resolveCallEdges } from "./typescript/edges.js";

// Polyglot whole-repo bootstrap (FR-1): tree-sitter skeletons for every TS/JS
// and Python file + ts-morph accurate edges for the TS files. I/O lives here
// (adapter), never the core (AD-1).

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "coverage", "fixtures", ".venv", "__pycache__"]);

export interface BootstrapCoverage {
  readonly found: number;
  readonly parsed: number;
  readonly failed: number;
  readonly skipped: readonly string[];
}

export interface BootstrapResult {
  readonly graph: CodeGraph;
  readonly coverage: BootstrapCoverage;
}

function isSourceFile(name: string): boolean {
  if (name.endsWith(".d.ts") || name.endsWith(".test.ts")) return false;
  return name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".py");
}

export function findSourceFiles(root: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findSourceFiles(full, acc);
    } else if (isSourceFile(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

export async function bootstrapRepo(rootDir: string, wasmDir: string): Promise<BootstrapResult> {
  const ts: LanguageAdapter = await createTypeScriptAdapter(wasmDir);
  const py: LanguageAdapter = await createPythonAdapter(wasmDir);
  const files = findSourceFiles(rootDir);
  const graph = new CodeGraph();
  const skipped: string[] = [];
  let parsed = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const source = fs.readFileSync(file, "utf8");
      const rel = path.relative(rootDir, file).split(path.sep).join("/");
      const adapter = file.endsWith(".py") ? py : ts;
      const { nodes, edges } = adapter.parseFile(rel, source);
      for (const node of nodes) graph.addNode(node);
      for (const edge of edges) graph.addEdge(edge);
      parsed += 1;
    } catch {
      failed += 1;
      skipped.push(path.relative(rootDir, file));
    }
  }

  // Accurate edges (ts-morph) over the TS/JS files only; Python accurate edges
  // (Pyright over LSP) are the next step.
  try {
    const tsFiles = files.filter((f) => !f.endsWith(".py"));
    const project = new Project();
    for (const file of tsFiles) project.addSourceFileAtPath(file);
    for (const edge of resolveImportEdges(project, rootDir)) graph.addEdge(edge);
    for (const edge of resolveCallEdges(project, rootDir)) graph.addEdge(edge);
  } catch {
    // Edge resolution is best-effort; the skeleton still stands.
  }

  return { graph, coverage: { found: files.length, parsed, failed, skipped } };
}
