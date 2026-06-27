import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { CodeGraph } from "../../core/graph/graph.js";
import type { LanguageAdapter } from "../../core/ports.js";
import { createTypeScriptAdapter } from "./typescript/index.js";
import { createPythonAdapter } from "./python/index.js";
import { resolveImportEdges, resolveCallEdges } from "./typescript/edges.js";
import { resolvePythonEdges } from "./python/pyright-edges.js";

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

export interface BootstrapOptions {
  /** Default true. */
  readonly typescript?: boolean;
  /** Default true. */
  readonly python?: boolean;
  /** Extra directory names to skip (from the watch-scope setting). */
  readonly exclude?: readonly string[];
}

function isSourceFile(name: string, ts: boolean, py: boolean): boolean {
  if (name.endsWith(".d.ts") || name.endsWith(".test.ts")) return false;
  if (ts && (name.endsWith(".ts") || name.endsWith(".tsx"))) return true;
  if (py && name.endsWith(".py")) return true;
  return false;
}

export function findSourceFiles(
  root: string,
  skip: ReadonlySet<string>,
  ts: boolean,
  py: boolean,
  acc: string[] = [],
): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dot-directories (.git, .claude, .bmad, .venv …): they hold
      // tooling, not the user's source, and scanning them pollutes the graph and
      // stalls the Python pass on unrelated scripts.
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      findSourceFiles(full, skip, ts, py, acc);
    } else if (isSourceFile(entry.name, ts, py)) {
      acc.push(full);
    }
  }
  return acc;
}

export async function bootstrapRepo(
  rootDir: string,
  wasmDir: string,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const useTs = options.typescript !== false;
  const usePy = options.python !== false;
  const skip = new Set([...SKIP_DIRS, ...(options.exclude ?? [])]);
  const tsAdapter: LanguageAdapter = await createTypeScriptAdapter(wasmDir);
  const pyAdapter: LanguageAdapter = await createPythonAdapter(wasmDir);
  const files = findSourceFiles(rootDir, skip, useTs, usePy);
  const graph = new CodeGraph();
  const skipped: string[] = [];
  let parsed = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const source = fs.readFileSync(file, "utf8");
      const rel = path.relative(rootDir, file).split(path.sep).join("/");
      const adapter = file.endsWith(".py") ? pyAdapter : tsAdapter;
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

  // Accurate Python edges (Pyright over LSP) — imports + calls; no-op for TS-only.
  try {
    for (const edge of await resolvePythonEdges(rootDir, files, wasmDir)) graph.addEdge(edge);
  } catch {
    // best-effort
  }

  return { graph, coverage: { found: files.length, parsed, failed, skipped } };
}
