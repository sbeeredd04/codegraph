import type { LanguageAdapter } from "../../../core/ports.js";
import { createSkeletonAdapter, type LanguageConfig } from "../skeleton.js";

// Story 1.3: TypeScript skeleton (module/class/function/method + contains).
// Accurate call/import edges come from ts-morph (./edges.ts, AD-9 two-layer).
const TS_CONFIG: LanguageConfig = {
  language: "typescript",
  prefix: "ts",
  grammarFile: "tree-sitter-typescript.wasm",
  functionTypes: ["function_declaration", "generator_function_declaration"],
  classType: "class_declaration",
  methodTypes: ["method_definition"],
  nameField: "name",
  bodyField: "body",
  unwrap: { type: "export_statement", field: "declaration" },
  doc: { kind: "preceding-comment", commentType: "comment" }, // FR-60: leading JSDoc/comment
  // FR-82: TS's `return_type` field text already includes the leading `: ` (it's a
  // `type_annotation`), so returnPrefix is empty — the raw fields compose directly.
  signature: { paramsField: "parameters", returnField: "return_type", returnPrefix: "" },
};

export function createTypeScriptAdapter(wasmDir: string): Promise<LanguageAdapter> {
  return createSkeletonAdapter(wasmDir, TS_CONFIG);
}
