import * as path from "node:path";
import { Parser, Language } from "@vscode/tree-sitter-wasm";
import type { LanguageAdapter } from "../../../core/ports.js";
import type { GraphNode, GraphEdge } from "../../../core/graph/types.js";

// Story 1.3: a tree-sitter (WASM) skeleton parser for TypeScript. Emits the
// structural nodes (module/class/function/method) + `contains` edges. Accurate
// call/import edges arrive via ts-morph in Story 1.5 (AD-9 two-layer parsing).

/** Minimal view of a tree-sitter node — only the surface we use. */
interface TsNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly namedChildren: readonly (TsNode | null)[];
  childForFieldName(field: string): TsNode | null;
}

let runtimeReady = false;

/**
 * Build a TypeScript adapter. `wasmDir` is the directory holding the tree-sitter
 * runtime + grammar wasm (the @vscode/tree-sitter-wasm `wasm/` folder); the caller
 * resolves it (DI keeps this adapter free of module-resolution assumptions).
 */
export async function createTypeScriptAdapter(wasmDir: string): Promise<LanguageAdapter> {
  if (!runtimeReady) {
    await Parser.init({ locateFile: (file: string) => path.join(wasmDir, file) });
    runtimeReady = true;
  }
  const language = await Language.load(path.join(wasmDir, "tree-sitter-typescript.wasm"));
  const parser = new Parser();
  parser.setLanguage(language);
  return new TypeScriptAdapter(parser);
}

class TypeScriptAdapter implements LanguageAdapter {
  readonly language = "typescript";

  constructor(private readonly parser: Parser) {}

  parseFile(filePath: string, source: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const tree = this.parser.parse(source);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const moduleAddress = `ts:${filePath}`;
    nodes.push({
      address: moduleAddress,
      kind: "module",
      name: filePath,
      location: { file: filePath, line: 0, character: 0 },
    });
    if (!tree) return { nodes, edges };

    for (const child of (tree.rootNode as unknown as TsNode).namedChildren) {
      if (child) this.collectTopLevel(child, filePath, moduleAddress, nodes, edges);
    }
    return { nodes, edges };
  }

  private collectTopLevel(
    node: TsNode,
    filePath: string,
    moduleAddress: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // Unwrap `export ...` to reach the underlying declaration.
    const decl = node.type === "export_statement" ? node.childForFieldName("declaration") ?? node : node;
    const loc = (n: TsNode) => ({ file: filePath, line: n.startPosition.row, character: n.startPosition.column });

    if (decl.type === "function_declaration" || decl.type === "generator_function_declaration") {
      const name = decl.childForFieldName("name")?.text;
      if (!name) return;
      const address = `ts:${filePath}#${name}`;
      nodes.push({ address, kind: "function", name, location: loc(decl) });
      edges.push({ from: moduleAddress, to: address, type: "contains" });
      return;
    }

    if (decl.type === "class_declaration") {
      const name = decl.childForFieldName("name")?.text;
      if (!name) return;
      const classAddress = `ts:${filePath}#${name}`;
      nodes.push({ address: classAddress, kind: "class", name, location: loc(decl) });
      edges.push({ from: moduleAddress, to: classAddress, type: "contains" });

      const body = decl.childForFieldName("body");
      for (const member of body?.namedChildren ?? []) {
        if (member?.type !== "method_definition") continue;
        const methodName = member.childForFieldName("name")?.text;
        if (!methodName) continue;
        const methodAddress = `ts:${filePath}#${name}.${methodName}`;
        nodes.push({ address: methodAddress, kind: "method", name: methodName, location: loc(member) });
        edges.push({ from: classAddress, to: methodAddress, type: "contains" });
      }
    }
  }
}
