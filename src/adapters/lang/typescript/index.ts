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
};

export function createTypeScriptAdapter(wasmDir: string): Promise<LanguageAdapter> {
  return createSkeletonAdapter(wasmDir, TS_CONFIG);
}
