import * as path from "node:path";
import { Node, SyntaxKind } from "ts-morph";
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

/** Address of a function/method declaration, matching the tree-sitter skeleton's
 * scheme. Returns undefined for anonymous decls or external files (lib/.d.ts/deps). */
function declarationAddress(node: Node | undefined, rootDir: string): string | undefined {
  if (!node) return undefined;
  const rel = toRel(rootDir, node.getSourceFile().getFilePath());
  if (rel.startsWith("..") || rel.includes("node_modules") || rel.endsWith(".d.ts")) return undefined;
  if (Node.isFunctionDeclaration(node)) {
    const name = node.getName();
    return name ? `ts:${rel}#${name}` : undefined;
  }
  if (Node.isMethodDeclaration(node)) {
    const name = node.getName();
    const className = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();
    return name && className ? `ts:${rel}#${className}.${name}` : undefined;
  }
  return undefined;
}

/**
 * Resolve `calls` edges (function/method -> function/method) via the type
 * checker. Calls to external/anonymous/arrow targets are skipped — only edges
 * whose endpoints match a skeleton node survive.
 */
export function resolveCallEdges(project: Project, rootDir: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    const callers: Node[] = [
      ...sourceFile.getFunctions(),
      ...sourceFile.getClasses().flatMap((c) => c.getMethods()),
    ];
    for (const caller of callers) {
      const from = declarationAddress(caller, rootDir);
      if (!from) continue;
      for (const call of caller.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const symbol = call.getExpression().getSymbol();
        if (!symbol) continue;
        // Symbol declarations, plus the import-alias target for cross-file calls.
        const targets = [
          ...symbol.getDeclarations(),
          ...(symbol.getAliasedSymbol()?.getDeclarations() ?? []),
        ];
        for (const target of targets) {
          const to = declarationAddress(target, rootDir);
          if (!to || to === from) continue;
          const key = `${from}->${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from, to, type: "calls" });
          break;
        }
      }
    }
  }
  return edges;
}
