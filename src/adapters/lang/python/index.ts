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
  // FR-85: Python depth — decorators (@app.get('/users'), @property), nested defs
  // (closures / decorator inners), and dataclass/typed class fields → class signature.
  decorator: { wrapperType: "decorated_definition", nodeType: "decorator" },
  nestedFunctions: true,
  classFields: { statementType: "expression_statement", assignmentType: "assignment" },
  // FR-97: same-file inheritance → `overrides` edges (subclass method → base method).
  // Python's `class Sub(Base):` puts bases in the `superclasses` argument_list; only bare
  // `identifier` bases are resolved here (dotted/imported bases need the LSP layer).
  inheritance: { kind: "field-list", superclassesField: "superclasses", simpleBaseType: "identifier" },
};

export function createPythonAdapter(wasmDir: string): Promise<LanguageAdapter> {
  return createSkeletonAdapter(wasmDir, PY_CONFIG);
}
