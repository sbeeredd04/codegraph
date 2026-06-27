import * as path from "node:path";
import { Parser, Language } from "@vscode/tree-sitter-wasm";
import type { LanguageAdapter } from "../../core/ports.js";
import type { GraphNode, GraphEdge } from "../../core/graph/types.js";

// Shared tree-sitter skeleton walker. TS and Python have the same structural
// shape (module > class > method, top-level functions) with different node-type
// names — so one config-driven walker serves both (spine F dial: pluggable
// per-language adapters). Accurate edges come from each language's edge layer.

/** Minimal view of a tree-sitter node — only the surface we use. */
export interface TsNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: readonly (TsNode | null)[];
  childForFieldName(field: string): TsNode | null;
}

export interface LanguageConfig {
  readonly language: string;
  /** Address prefix, e.g. "ts" or "py". */
  readonly prefix: string;
  readonly grammarFile: string;
  readonly functionTypes: readonly string[];
  readonly classType: string;
  readonly methodTypes: readonly string[];
  readonly nameField: string;
  readonly bodyField: string;
  /** Wrapper to descend through to reach a declaration (export/decorator). */
  readonly unwrap?: { readonly type: string; readonly field: string };
}

function loc(node: TsNode, file: string) {
  return { file, line: node.startPosition.row, character: node.startPosition.column };
}

function unwrap(node: TsNode, config: LanguageConfig): TsNode {
  if (config.unwrap && node.type === config.unwrap.type) {
    return node.childForFieldName(config.unwrap.field) ?? node;
  }
  return node;
}

export function extractSkeleton(
  root: TsNode,
  filePath: string,
  config: LanguageConfig,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const moduleAddress = `${config.prefix}:${filePath}`;
  nodes.push({ address: moduleAddress, kind: "module", name: filePath, location: loc(root, filePath) });

  for (const child of root.namedChildren) {
    if (child) collect(child, filePath, moduleAddress, nodes, edges, config);
  }
  return { nodes, edges };
}

function collect(
  node: TsNode,
  filePath: string,
  moduleAddress: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: LanguageConfig,
): void {
  const decl = unwrap(node, config);
  const addr = (name: string) => `${config.prefix}:${filePath}#${name}`;

  if (config.functionTypes.includes(decl.type)) {
    const name = decl.childForFieldName(config.nameField)?.text;
    if (!name) return;
    nodes.push({ address: addr(name), kind: "function", name, location: loc(decl, filePath) });
    edges.push({ from: moduleAddress, to: addr(name), type: "contains" });
    return;
  }

  if (decl.type === config.classType) {
    const name = decl.childForFieldName(config.nameField)?.text;
    if (!name) return;
    const classAddress = addr(name);
    nodes.push({ address: classAddress, kind: "class", name, location: loc(decl, filePath) });
    edges.push({ from: moduleAddress, to: classAddress, type: "contains" });

    const body = decl.childForFieldName(config.bodyField);
    for (const member of body?.namedChildren ?? []) {
      if (!member) continue;
      const m = unwrap(member, config);
      if (!config.methodTypes.includes(m.type)) continue;
      const methodName = m.childForFieldName(config.nameField)?.text;
      if (!methodName) continue;
      const methodAddress = `${classAddress}.${methodName}`;
      nodes.push({ address: methodAddress, kind: "method", name: methodName, location: loc(m, filePath) });
      edges.push({ from: classAddress, to: methodAddress, type: "contains" });
    }
  }
}

let runtimeReady = false;

/** Build a skeleton adapter for a language from its config + grammar wasm. */
export async function createSkeletonAdapter(wasmDir: string, config: LanguageConfig): Promise<LanguageAdapter> {
  if (!runtimeReady) {
    await Parser.init({ locateFile: (file: string) => path.join(wasmDir, file) });
    runtimeReady = true;
  }
  const language = await Language.load(path.join(wasmDir, config.grammarFile));
  const parser = new Parser();
  parser.setLanguage(language);

  return {
    language: config.language,
    parseFile(filePath: string, source: string) {
      const tree = parser.parse(source);
      if (!tree) {
        const moduleAddress = `${config.prefix}:${filePath}`;
        return {
          nodes: [{ address: moduleAddress, kind: "module", name: filePath, location: { file: filePath, line: 0, character: 0 } }],
          edges: [],
        };
      }
      return extractSkeleton(tree.rootNode as unknown as TsNode, filePath, config);
    },
  };
}
