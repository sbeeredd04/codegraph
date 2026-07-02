import type { LanguageAdapter } from "../../../core/ports.js";
import { createSkeletonAdapter, type LanguageConfig } from "../skeleton.js";

// Story 1.7 (skeleton): Python module/class/function/method + contains edges,
// via the shared tree-sitter walker. Accurate Python edges (Pyright over LSP)
// land separately in pyright-edges.ts (resolvePythonEdges), wired in bootstrap.
const PY_CONFIG: LanguageConfig = {
  language: "python",
  prefix: "py",
  grammarFile: "tree-sitter-python.wasm",
  functionTypes: ["function_definition"],
  classType: "class_definition",
  methodTypes: ["function_definition"],
  nameField: "name",
  bodyField: "body",
  unwrap: { type: "decorated_definition", field: "definition" },
  doc: { kind: "body-docstring", stringType: "string" }, // FR-60: leading docstring
};

export function createPythonAdapter(wasmDir: string): Promise<LanguageAdapter> {
  return createSkeletonAdapter(wasmDir, PY_CONFIG);
}
