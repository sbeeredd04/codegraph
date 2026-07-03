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
  /**
   * How to capture a declaration's leading doc-comment into `GraphNode.doc` (FR-60,
   * the docstring-fallback note). `preceding-comment` (TS/JS): the immediately-
   * preceding sibling if it's a comment. `body-docstring` (Python): the first
   * statement in the body when it's a bare string literal. Omit to capture no doc.
   */
  readonly doc?:
    | { readonly kind: "preceding-comment"; readonly commentType: string }
    | { readonly kind: "body-docstring"; readonly stringType: string };
  /**
   * How to capture a function/method's STRUCTURAL signature into `GraphNode.signature`
   * (FR-82): the parameter list + return type read straight off the declaration's
   * tree-sitter fields. `returnPrefix` joins the return type — "" for TS (its
   * `return_type` field text already includes the leading `: `), " -> " for Python
   * (its `return_type` field is the bare type). Types/annotations are structural API
   * metadata, NOT source bytes, so the signature is cloud-safe (AD-14) and is fed to
   * parseSignature (FR-59 I/O, T8.8 trace) and the lookup haystack. Omit to skip.
   */
  readonly signature?: {
    readonly paramsField: string;
    readonly returnField: string;
    readonly returnPrefix: string;
  };
  /**
   * How to capture a module-level `const Name = () => …` / `const Name = function…`
   * as a function node (FR-83). This `const X = arrow` shape is the DOMINANT one in
   * React / React-Native code (components + hooks), yet `functionTypes` only matches
   * plain declarations, so without this most of an RN app is invisible. `valueTypes`
   * are the initializer node types that count as a function (arrow/function
   * expression). Omit to skip (Python has no equivalent shape).
   */
  readonly variableFunction?: {
    readonly declarationTypes: readonly string[];
    readonly declaratorType: string;
    readonly valueField: string;
    readonly valueTypes: readonly string[];
  };
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

/** The doc-comment for a run of statements: the leading bare string literal, if any
 *  (a Python module/def/class docstring is the first statement in the block). */
function docFromStatements(
  children: readonly (TsNode | null)[],
  stringType: string,
): string | undefined {
  const first = children.find((c): c is TsNode => c != null);
  if (!first) return undefined;
  const str =
    first.type === stringType ? first : (first.namedChildren.find((c) => c?.type === stringType) ?? null);
  return str?.text;
}

/** Capture a declaration's raw leading doc-comment (delimiters intact — `doc-note`
 *  strips them), or undefined. `prev` is the declaration's preceding sibling, used
 *  by the `preceding-comment` (TS JSDoc) strategy. */
function extractDoc(decl: TsNode, prev: TsNode | null, config: LanguageConfig): string | undefined {
  const d = config.doc;
  if (!d) return undefined;
  if (d.kind === "preceding-comment") {
    return prev && prev.type === d.commentType ? prev.text : undefined;
  }
  const body = decl.childForFieldName(config.bodyField);
  return body ? docFromStatements(body.namedChildren, d.stringType) : undefined;
}

/** Build a function/method's structural signature (FR-82): `name(params)` plus the
 *  return type when the declaration has one. `undefined` when there's no signature
 *  config or the declaration has no parameter list (e.g. a class has no params). */
function extractSignature(decl: TsNode, name: string, config: LanguageConfig): string | undefined {
  const sig = config.signature;
  if (!sig) return undefined;
  const params = decl.childForFieldName(sig.paramsField)?.text;
  if (params === undefined) return undefined;
  const ret = decl.childForFieldName(sig.returnField)?.text;
  return `${name}${params}${ret ? sig.returnPrefix + ret : ""}`;
}

export function extractSkeleton(
  root: TsNode,
  filePath: string,
  config: LanguageConfig,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const moduleAddress = `${config.prefix}:${filePath}`;
  // A file-level docstring (Python module docstring). TS has no unambiguous file-doc
  // — a leading comment reads as the first declaration's JSDoc — so only body-docstring.
  const moduleDoc =
    config.doc?.kind === "body-docstring"
      ? docFromStatements(root.namedChildren, config.doc.stringType)
      : undefined;
  nodes.push(withDoc({ address: moduleAddress, kind: "module", name: filePath, location: loc(root, filePath) }, moduleDoc));

  // Track the preceding sibling so the preceding-comment (JSDoc) strategy can reach it.
  const kids = root.namedChildren;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child) collect(child, kids[i - 1] ?? null, filePath, moduleAddress, nodes, edges, config);
  }
  return { nodes, edges };
}

/** Attach a captured doc-comment to a node, omitting the field when there's none. */
function withDoc(node: GraphNode, doc: string | undefined): GraphNode {
  return doc ? { ...node, doc } : node;
}

/** Attach doc + structural signature (FR-82) to a callable node, omitting each field
 *  when absent. `signature` is structural (types, not source bytes) so — unlike `doc`
 *  — it is NOT host-local and rides the portable snapshot (AD-14). */
function callableNode(
  node: GraphNode,
  doc: string | undefined,
  signature: string | undefined,
): GraphNode {
  return withDoc(signature ? { ...node, signature } : node, doc);
}

function collect(
  node: TsNode,
  prev: TsNode | null,
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
    nodes.push(callableNode({ address: addr(name), kind: "function", name, location: loc(decl, filePath) }, extractDoc(decl, prev, config), extractSignature(decl, name, config)));
    edges.push({ from: moduleAddress, to: addr(name), type: "contains" });
    return;
  }

  // FR-83: `const App = () => …` / `const useThing = function…` — the React/RN
  // component + hook shape that `functionTypes` (declarations only) misses.
  const vf = config.variableFunction;
  if (vf && vf.declarationTypes.includes(decl.type)) {
    let first = true;
    for (const declarator of decl.namedChildren) {
      if (!declarator || declarator.type !== vf.declaratorType) continue;
      const nameNode = declarator.childForFieldName(config.nameField);
      const value = declarator.childForFieldName(vf.valueField);
      // Only a simple `identifier = arrow/function` — skip destructuring patterns
      // and non-function initializers (a call, object, etc.).
      if (!nameNode || nameNode.type !== "identifier" || !value || !vf.valueTypes.includes(value.type)) {
        first = false;
        continue;
      }
      const name = nameNode.text;
      // Only the first declarator can carry the declaration's leading doc-comment.
      const doc = first ? extractDoc(decl, prev, config) : undefined;
      nodes.push(callableNode(
        { address: addr(name), kind: "function", name, location: loc(declarator, filePath) },
        doc,
        extractSignature(value, name, config),
      ));
      edges.push({ from: moduleAddress, to: addr(name), type: "contains" });
      first = false;
    }
    return;
  }

  if (decl.type === config.classType) {
    const name = decl.childForFieldName(config.nameField)?.text;
    if (!name) return;
    const classAddress = addr(name);
    nodes.push(withDoc({ address: classAddress, kind: "class", name, location: loc(decl, filePath) }, extractDoc(decl, prev, config)));
    edges.push({ from: moduleAddress, to: classAddress, type: "contains" });

    const members = decl.childForFieldName(config.bodyField)?.namedChildren ?? [];
    for (let j = 0; j < members.length; j++) {
      const member = members[j];
      if (!member) continue;
      const m = unwrap(member, config);
      if (!config.methodTypes.includes(m.type)) continue;
      const methodName = m.childForFieldName(config.nameField)?.text;
      if (!methodName) continue;
      const methodAddress = `${classAddress}.${methodName}`;
      nodes.push(callableNode({ address: methodAddress, kind: "method", name: methodName, location: loc(m, filePath) }, extractDoc(m, members[j - 1] ?? null, config), extractSignature(m, methodName, config)));
      edges.push({ from: classAddress, to: methodAddress, type: "contains" });
    }
  }
}

let runtimeReady = false;

/** Load a tree-sitter parser for a grammar wasm (init once; ABI-matched runtime). */
export async function loadGrammar(wasmDir: string, grammarFile: string): Promise<Parser> {
  if (!runtimeReady) {
    await Parser.init({ locateFile: (file: string) => path.join(wasmDir, file) });
    runtimeReady = true;
  }
  const language = await Language.load(path.join(wasmDir, grammarFile));
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

/** Build a skeleton adapter for a language from its config + grammar wasm. */
export async function createSkeletonAdapter(wasmDir: string, config: LanguageConfig): Promise<LanguageAdapter> {
  const parser = await loadGrammar(wasmDir, config.grammarFile);

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
