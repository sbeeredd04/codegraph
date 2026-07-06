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
  /**
   * How to capture leading decorators (FR-85) into `node.decorators`, e.g. the
   * `@app.get('/users')` FastAPI route or `@property`. `wrapperType` is the node that
   * wraps a decorated declaration (`decorated_definition`), `nodeType` each decorator
   * child. AD-14-safe: only the decorator's callee dotted-name + string/number LITERAL
   * args are kept (arbitrary decorator expressions are elided), so no source logic
   * reaches the cloud — a route path is API surface, like a signature type. Omit to skip.
   */
  readonly decorator?: { readonly wrapperType: string; readonly nodeType: string };
  /**
   * Recurse into function/method bodies to capture nested `def`s (FR-85) — closures and
   * decorator/factory inners — as `#outer.inner` nodes. Direct body children only (a def
   * inside an if/for is deferred), depth-bounded. Python-only for now. Omit to skip.
   */
  readonly nestedFunctions?: boolean;
  /**
   * Synthesize a class's typed field list into its `signature` (FR-85), e.g.
   * `Config(name: str, count: int = 0)` for a @dataclass / pydantic / typed-attr class —
   * so the class node reads like its generated constructor. `statementType` wraps each
   * class-body field, `assignmentType` is the typed assignment. Structural (cloud-safe),
   * reuses the existing signature field. Omit to skip.
   */
  readonly classFields?: { readonly statementType: string; readonly assignmentType: string };
  /**
   * Capture class inheritance so a subclass method that redefines an inherited method
   * emits an `overrides` edge to the base method (FR-97) — e.g. `HTTPAdapter.send` →
   * `BaseAdapter.send`. This closes the virtual-dispatch gap the agent benchmark surfaced:
   * a call statically resolves to the abstract base method, and the override edge names
   * the concrete implementation reached at runtime. `superclassesField` is the class node's
   * base-list field (Python `superclasses`, an `argument_list`); only bases of `simpleBaseType`
   * (a bare same-file `identifier`) are resolved — dotted/generic/imported bases (`base.Thing`,
   * `Generic[T]`) need cross-file type resolution and are deferred to the LSP edge layer. So
   * this is SAME-FILE inheritance only, resolved purely from names (cloud-safe). Omit to skip.
   */
  readonly inheritance?: { readonly superclassesField: string; readonly simpleBaseType: string };
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

// AD-14-safe decorator arg literals: a route path / config constant is API surface,
// like a signature default. Anything else (a call, name, lambda) is elided so a
// decorator can't smuggle source logic to the cloud plane.
const DECORATOR_LITERALS = new Set(["string", "integer", "float", "true", "false", "none"]);

/** One decorator's AD-14-safe label (FR-85): the callee dotted-name, plus its args
 *  ONLY when every arg is a literal (`app.get('/users')`, `field(default=…)`→`field`). */
function decoratorLabel(decorator: TsNode): string | undefined {
  const inner = decorator.namedChildren.find((c): c is TsNode => c != null);
  if (!inner) return undefined;
  if (inner.type === "call") {
    const callee = inner.childForFieldName("function")?.text ?? inner.text;
    const argList = inner.childForFieldName("arguments");
    const args = argList?.namedChildren.filter((a): a is TsNode => a != null) ?? [];
    if (args.length && args.every((a) => DECORATOR_LITERALS.has(a.type))) {
      return `${callee}(${args.map((a) => a.text).join(", ")})`;
    }
    return callee; // non-literal args elided (may carry source expressions)
  }
  return inner.text; // bare @dataclass / @property / dotted @app.route
}

/** Capture a decorated declaration's leading decorators (FR-85). `node` is the raw
 *  (pre-unwrap) node — decorators live on the wrapper, not the definition. */
function extractDecorators(node: TsNode, config: LanguageConfig): string[] | undefined {
  const d = config.decorator;
  if (!d || node.type !== d.wrapperType) return undefined;
  const labels: string[] = [];
  for (const child of node.namedChildren) {
    if (child?.type !== d.nodeType) continue;
    const label = decoratorLabel(child);
    if (label) labels.push(label);
  }
  return labels.length ? labels : undefined;
}

/** Synthesize a class's typed-field list into a constructor-style signature (FR-85):
 *  `Config(name: str, count: int = 0)`. Only class-body assignments WITH a type
 *  annotation count (dataclass / pydantic / typed attributes) — untyped class vars are
 *  skipped. `undefined` when there's no field config or no typed fields. */
function classFieldSignature(classDecl: TsNode, className: string, config: LanguageConfig): string | undefined {
  const cf = config.classFields;
  if (!cf) return undefined;
  const body = classDecl.childForFieldName(config.bodyField);
  if (!body) return undefined;
  const fields: string[] = [];
  for (const stmt of body.namedChildren) {
    if (stmt?.type !== cf.statementType) continue;
    const assign = stmt.namedChildren.find((c): c is TsNode => c?.type === cf.assignmentType);
    if (!assign) continue;
    const name = assign.childForFieldName("left")?.text;
    const type = assign.childForFieldName("type")?.text;
    if (!name || !type) continue; // only typed fields
    const value = assign.childForFieldName("right")?.text;
    fields.push(`${name}: ${type}${value ? ` = ${value}` : ""}`);
  }
  return fields.length ? `${className}(${fields.join(", ")})` : undefined;
}

/** Attach captured decorators (structural, cloud-safe — FR-85), omitting when none. */
function withDecorators(node: GraphNode, decorators: string[] | undefined): GraphNode {
  return decorators && decorators.length ? { ...node, decorators } : node;
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
  // `classes` accumulates each class's method set + base names for the FR-97 override pass,
  // which runs once the whole file is walked (a subclass can precede its base in source).
  const classes: ClassEntry[] = [];
  const kids = root.namedChildren;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child) collect(child, kids[i - 1] ?? null, filePath, moduleAddress, nodes, edges, config, classes);
  }
  edges.push(...resolveOverrideEdges(classes, config));
  return { nodes, edges };
}

/** One class's shape for same-file override resolution (FR-97): its address, its own
 *  methods (name → address), and the simple base-class names it declares. */
interface ClassEntry {
  readonly name: string;
  readonly address: string;
  readonly bases: readonly string[];
  readonly methods: ReadonlyMap<string, string>;
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
  classes: ClassEntry[],
): void {
  const decl = unwrap(node, config);
  const addr = (name: string) => `${config.prefix}:${filePath}#${name}`;

  if (config.functionTypes.includes(decl.type)) {
    const name = decl.childForFieldName(config.nameField)?.text;
    if (!name) return;
    nodes.push(withDecorators(
      callableNode({ address: addr(name), kind: "function", name, location: loc(decl, filePath) }, extractDoc(decl, prev, config), extractSignature(decl, name, config)),
      extractDecorators(node, config),
    ));
    edges.push({ from: moduleAddress, to: addr(name), type: "contains" });
    // FR-85: nested `def`s (closures / decorator inners) as `#name.inner` nodes.
    collectNested(decl, addr(name), filePath, nodes, edges, config, 1);
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
    // FR-85: the class node carries its decorators + a synthesized typed-field signature.
    nodes.push(withDecorators(
      callableNode({ address: classAddress, kind: "class", name, location: loc(decl, filePath) }, extractDoc(decl, prev, config), classFieldSignature(decl, name, config)),
      extractDecorators(node, config),
    ));
    edges.push({ from: moduleAddress, to: classAddress, type: "contains" });

    // FR-97: remember each method's address so the post-walk pass can wire a subclass
    // method that redefines an inherited one to its base (same-file resolution only).
    const methods = new Map<string, string>();
    const members = decl.childForFieldName(config.bodyField)?.namedChildren ?? [];
    for (let j = 0; j < members.length; j++) {
      const member = members[j];
      if (!member) continue;
      const m = unwrap(member, config);
      if (!config.methodTypes.includes(m.type)) continue;
      const methodName = m.childForFieldName(config.nameField)?.text;
      if (!methodName) continue;
      const methodAddress = `${classAddress}.${methodName}`;
      nodes.push(withDecorators(
        callableNode({ address: methodAddress, kind: "method", name: methodName, location: loc(m, filePath) }, extractDoc(m, members[j - 1] ?? null, config), extractSignature(m, methodName, config)),
        extractDecorators(member, config),
      ));
      edges.push({ from: classAddress, to: methodAddress, type: "contains" });
      methods.set(methodName, methodAddress);
      // FR-85: nested `def`s inside a method body, too.
      collectNested(m, methodAddress, filePath, nodes, edges, config, 1);
    }

    if (config.inheritance) {
      classes.push({ name, address: classAddress, bases: extractBases(decl, config), methods });
    }
  }
}

/** FR-97: a class's simple same-file base names — bare `identifier` bases only (e.g.
 *  `BaseAdapter`). Dotted (`base.Thing`) and generic (`Generic[T]`) bases are skipped:
 *  resolving them needs cross-file type info, which the LSP edge layer owns. */
function extractBases(classDecl: TsNode, config: LanguageConfig): string[] {
  const inh = config.inheritance;
  if (!inh) return [];
  const supers = classDecl.childForFieldName(inh.superclassesField);
  if (!supers) return [];
  const names: string[] = [];
  for (const child of supers.namedChildren) {
    if (child?.type === inh.simpleBaseType) names.push(child.text);
  }
  return names;
}

/** FR-97: for every class with a same-file base, emit an `overrides` edge from each
 *  method that redefines an inherited method to the nearest base method of that name
 *  (`HTTPAdapter.send` → `BaseAdapter.send`). Cross-file bases are absent from the
 *  registry, so they're silently skipped — that's the LSP layer's job. Cycle-safe. */
function resolveOverrideEdges(classes: readonly ClassEntry[], config: LanguageConfig): GraphEdge[] {
  if (!config.inheritance || classes.length === 0) return [];
  const byName = new Map(classes.map((c) => [c.name, c]));
  const edges: GraphEdge[] = [];
  for (const cls of classes) {
    if (cls.bases.length === 0) continue;
    for (const [methodName, methodAddress] of cls.methods) {
      const baseAddress = nearestBaseMethod(cls, methodName, byName);
      if (baseAddress && baseAddress !== methodAddress) {
        edges.push({ from: methodAddress, to: baseAddress, type: "overrides" });
      }
    }
  }
  return edges;
}

/** Breadth-first walk up `cls`'s base chain (nearest base first) for the first same-file
 *  class that defines a method named `methodName`; returns that base method's address. */
function nearestBaseMethod(
  cls: ClassEntry,
  methodName: string,
  byName: ReadonlyMap<string, ClassEntry>,
): string | undefined {
  const seen = new Set<string>([cls.name]);
  const queue = [...cls.bases];
  while (queue.length > 0) {
    const baseName = queue.shift() as string;
    if (seen.has(baseName)) continue;
    seen.add(baseName);
    const base = byName.get(baseName);
    if (!base) continue; // cross-file base — deferred to the LSP edge layer
    const hit = base.methods.get(methodName);
    if (hit) return hit;
    queue.push(...base.bases);
  }
  return undefined;
}

/** FR-85: recurse a function/method body for nested `def`s, emitting each as a
 *  `#parent.inner` function node + a contains edge from the parent. Direct body
 *  children only; depth-bounded so pathological nesting can't run away. */
function collectNested(
  fnDecl: TsNode,
  parentAddress: string,
  filePath: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: LanguageConfig,
  depth: number,
): void {
  if (!config.nestedFunctions || depth > 3) return;
  const body = fnDecl.childForFieldName(config.bodyField);
  if (!body) return;
  for (const child of body.namedChildren) {
    if (!child) continue;
    const inner = unwrap(child, config);
    if (!config.functionTypes.includes(inner.type)) continue;
    const name = inner.childForFieldName(config.nameField)?.text;
    if (!name) continue;
    const address = `${parentAddress}.${name}`;
    nodes.push(withDecorators(
      callableNode({ address, kind: "function", name, location: loc(inner, filePath) }, extractDoc(inner, null, config), extractSignature(inner, name, config)),
      extractDecorators(child, config),
    ));
    edges.push({ from: parentAddress, to: address, type: "contains" });
    collectNested(inner, address, filePath, nodes, edges, config, depth + 1);
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
