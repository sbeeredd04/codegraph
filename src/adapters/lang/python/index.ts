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
  // FR-82: Python's `return_type` field is the BARE type (e.g. `str`), so join it
  // with the ` -> ` arrow to mirror the source `def f(a: int) -> str:` form.
  signature: { paramsField: "parameters", returnField: "return_type", returnPrefix: " -> " },
};

export function createPythonAdapter(wasmDir: string): Promise<LanguageAdapter> {
  return createSkeletonAdapter(wasmDir, PY_CONFIG);
}
