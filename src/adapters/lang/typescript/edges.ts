import * as path from "node:path";
import type { Project } from "ts-morph";
import type { GraphEdge } from "../../../core/graph/types.js";

// Accurate edge layer (AD-9): ts-morph resolves cross-file references the
// tree-sitter skeleton can't. v1 covers module-level `depends-on` (imports);
// `calls` edges (function->function) are the next refinement.

function toRel(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

/**
 * Resolve module-level dependency edges for every source file in the project.
 * Imports that don't resolve to an in-project file (external packages, missing
 * modules) are skipped — only real intra-project dependencies become edges.
 */
export function resolveImportEdges(project: Project, rootDir: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const from = `ts:${toRel(rootDir, sourceFile.getFilePath())}`;
    for (const decl of sourceFile.getImportDeclarations()) {
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue;
      const to = `ts:${toRel(rootDir, target.getFilePath())}`;
      if (from !== to) edges.push({ from, to, type: "depends-on" });
    }
  }
  return edges;
}
