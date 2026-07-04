import { Project } from "ts-morph";
import type { LanguageAdapter } from "../../core/ports.js";
import type { GraphEdge } from "../../core/graph/types.js";
import { createTypeScriptAdapter, createTsxAdapter } from "./typescript/index.js";
import { createPythonAdapter } from "./python/index.js";
import { resolveImportEdges, resolveCallEdges, resolveRenderEdges } from "./typescript/edges.js";
import { resolvePythonEdges } from "./python/pyright-edges.js";

// FR-86: the language registry — the single data table that drives which files the
// polyglot scan reads, which grammar parses each, and how each family's accurate
// cross-file edges are resolved. Before this, all three were hardcoded across
// bootstrap.ts (a TS_JS_EXTENSIONS list, an `adapterFor` ternary, hand-built
// adapters, a `!.py` edge filter). Now adding a language is adding a row here.
//
// Adapter-layer (may import ts-morph / Pyright / the per-language modules); bootstrap
// consumes it. The tree-sitter parsing itself still lives in each language module.

/** A language family maps 1:1 to a BootstrapOptions toggle (typescript / python). */
export type LanguageFamily = "typescript" | "python";

export const LANGUAGE_FAMILIES: readonly LanguageFamily[] = ["typescript", "python"];

/**
 * One grammar registration: which file extensions it parses and how to build its
 * tree-sitter skeleton adapter. A family can have several (TypeScript splits `.ts`
 * from the JSX-bearing `.tsx`/`.jsx`/`.js`, which need the tsx grammar) — they share
 * a family (one toggle, one edge resolver) but dispatch to different grammars.
 */
export interface GrammarRegistration {
  readonly id: string;
  readonly family: LanguageFamily;
  readonly extensions: readonly string[];
  readonly createAdapter: (wasmDir: string) => Promise<LanguageAdapter>;
}

/**
 * A family's accurate cross-file edge resolver — ts-morph for the TS/JS family
 * (imports + calls + JSX renders over one shared Project), Pyright for Python. Runs
 * once over that family's files after the skeleton pass. `resolve` receives ONLY the
 * files belonging to the family; best-effort (bootstrap wraps each in try/catch).
 */
export interface EdgeResolver {
  readonly family: LanguageFamily;
  readonly resolve: (
    rootDir: string,
    files: readonly string[],
    wasmDir: string,
  ) => Promise<readonly GraphEdge[]>;
}

// Longest extension first is not required (endsWith across these is unambiguous —
// `.tsx` never ends with `.ts`, `.mjs` never with `.js`) but grammarForFile resolves
// by longest match anyway, so order here is irrelevant.
export const GRAMMARS: readonly GrammarRegistration[] = [
  // Plain TypeScript: its `<T>value` type-assertion would mis-parse under tsx.wasm.
  { id: "typescript", family: "typescript", extensions: [".ts"], createAdapter: createTypeScriptAdapter },
  // The JSX superset (React/RN): .tsx/.jsx and plain JS that may embed JSX.
  {
    id: "tsx",
    family: "typescript",
    extensions: [".tsx", ".jsx", ".js", ".mjs", ".cjs"],
    createAdapter: createTsxAdapter,
  },
  { id: "python", family: "python", extensions: [".py"], createAdapter: createPythonAdapter },
];

export const EDGE_RESOLVERS: readonly EdgeResolver[] = [
  {
    family: "typescript",
    resolve: (rootDir, files) => {
      const project = new Project();
      for (const file of files) project.addSourceFileAtPath(file);
      return Promise.resolve([
        ...resolveImportEdges(project, rootDir),
        ...resolveCallEdges(project, rootDir),
        ...resolveRenderEdges(project, rootDir),
      ]);
    },
  },
  {
    family: "python",
    resolve: (rootDir, files, wasmDir) => resolvePythonEdges(rootDir, files, wasmDir),
  },
];

// Files we never parse regardless of grammar: TypeScript declaration files and
// test/spec files across the whole TS/JS family — they aren't the app.
const EXCLUDED_FILE = /(\.d\.ts|\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs))$/;

/** The set of enabled families for a run (both default on; a false toggle drops one). */
export function enabledFamilies(options: { typescript?: boolean; python?: boolean }): Set<LanguageFamily> {
  const enabled = new Set<LanguageFamily>();
  for (const family of LANGUAGE_FAMILIES) {
    if (options[family] !== false) enabled.add(family);
  }
  return enabled;
}

/**
 * The grammar registration for a file, honoring the enabled families and the global
 * declaration/test exclusion. Longest matching extension wins, so a future `.d.mts`-
 * style overlap resolves deterministically. `undefined` → the file is not source.
 */
export function grammarForFile(
  file: string,
  enabled: ReadonlySet<LanguageFamily>,
): GrammarRegistration | undefined {
  if (EXCLUDED_FILE.test(file)) return undefined;
  let best: GrammarRegistration | undefined;
  let bestLen = -1;
  for (const grammar of GRAMMARS) {
    if (!enabled.has(grammar.family)) continue;
    for (const ext of grammar.extensions) {
      if (file.endsWith(ext) && ext.length > bestLen) {
        best = grammar;
        bestLen = ext.length;
      }
    }
  }
  return best;
}

/** Whether a file is parseable source under the enabled families (scan filter). */
export function isSourceFile(file: string, enabled: ReadonlySet<LanguageFamily>): boolean {
  return grammarForFile(file, enabled) !== undefined;
}

/** Build the skeleton adapter for each enabled grammar, keyed by registration id. */
export async function createAdapters(
  wasmDir: string,
  enabled: ReadonlySet<LanguageFamily>,
): Promise<Map<string, LanguageAdapter>> {
  const adapters = new Map<string, LanguageAdapter>();
  for (const grammar of GRAMMARS) {
    if (!enabled.has(grammar.family)) continue;
    adapters.set(grammar.id, await grammar.createAdapter(wasmDir));
  }
  return adapters;
}
