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
  // FR-83: capture `const App = () => …` / `const useThing = function…` (React/RN
  // components + hooks). `value` is the declarator's initializer field; the tsx/ts
  // grammars name it `value` and the arrow/function-expression exposes the same
  // `parameters`/`return_type` fields as a plain declaration, so signatures work too.
  variableFunction: {
    declarationTypes: ["lexical_declaration", "variable_declaration"],
    declaratorType: "variable_declarator",
    valueField: "value",
    valueTypes: ["arrow_function", "function_expression"],
  },
  // FR-97: same-file inheritance → `overrides` edges (subclass method → base method).
  // TS/JS put the base under a `class_heritage` child → `extends_clause` → `value` field;
  // only a bare `identifier` value (`class HTTP extends Base`) is resolved same-file —
  // dotted `mod.Base` (member_expression) needs the type layer.
  inheritance: {
    kind: "heritage-clause",
    heritageType: "class_heritage",
    clauseType: "extends_clause",
    valueField: "value",
    simpleBaseType: "identifier",
  },
};

// FR-83: the TSX/JSX grammar (a superset of TS + JSX + plain JS) so `.tsx`, `.jsx`,
// and `.js`/`.mjs`/`.cjs` files parse WITHOUT the JSX mis-parse the plain-TS grammar
// produces on `<Component/>`. Same node vocabulary as TS (only the grammar wasm and
// language label differ), so it reuses TS_CONFIG. Plain `.ts` stays on the TS grammar
// (its `<T>value` type-assertion syntax would be mistaken for JSX under tsx.wasm).
const TSX_CONFIG: LanguageConfig = {
  ...TS_CONFIG,
  language: "tsx",
  grammarFile: "tree-sitter-tsx.wasm",
};

export function createTypeScriptAdapter(wasmDir: string): Promise<LanguageAdapter> {
  return createSkeletonAdapter(wasmDir, TS_CONFIG);
}

/** FR-83: adapter for JSX-bearing files (`.tsx`/`.jsx`/`.js`/`.mjs`/`.cjs`) — the tsx
 *  grammar. Keeps the `ts:` address prefix so its nodes line up with the shared
 *  ts-morph edge layer. */
export function createTsxAdapter(wasmDir: string): Promise<LanguageAdapter> {
  return createSkeletonAdapter(wasmDir, TSX_CONFIG);
}
