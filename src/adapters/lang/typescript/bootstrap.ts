import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { CodeGraph } from "../../../core/graph/graph.js";
import { createTypeScriptAdapter } from "./index.js";
import { resolveImportEdges, resolveCallEdges } from "./edges.js";

// Whole-repo bootstrap (FR-1): tree-sitter skeleton across every source file +
// ts-morph import edges, assembled into one graph. I/O lives here (adapter), not
// in the core (AD-1).

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "coverage", "fixtures"]);

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

export function findTsFiles(root: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findTsFiles(full, acc);
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

export async function bootstrapTypeScriptRepo(rootDir: string, wasmDir: string): Promise<BootstrapResult> {
  const adapter = await createTypeScriptAdapter(wasmDir);
  const files = findTsFiles(rootDir);
  const graph = new CodeGraph();
  const skipped: string[] = [];
  let parsed = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const source = fs.readFileSync(file, "utf8");
      const rel = path.relative(rootDir, file).split(path.sep).join("/");
      const { nodes, edges } = adapter.parseFile(rel, source);
      for (const node of nodes) graph.addNode(node);
      for (const edge of edges) graph.addEdge(edge);
      parsed += 1;
    } catch {
      failed += 1;
      skipped.push(path.relative(rootDir, file));
    }
  }

  try {
    const project = new Project();
    for (const file of files) project.addSourceFileAtPath(file);
    for (const edge of resolveImportEdges(project, rootDir)) graph.addEdge(edge);
    for (const edge of resolveCallEdges(project, rootDir)) graph.addEdge(edge);
  } catch {
    // Edge resolution is best-effort; the skeleton still stands.
  }

  return { graph, coverage: { found: files.length, parsed, failed, skipped } };
}
