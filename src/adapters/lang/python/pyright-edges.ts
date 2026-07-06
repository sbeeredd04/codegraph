import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadGrammar, type TsNode } from "../skeleton.js";
import { PyrightClient, locationTarget, type LspPosition } from "./pyright-client.js";
import type { GraphEdge } from "../../../core/graph/types.js";

// Accurate Python edges (AD-9) via Pyright over LSP: module `depends-on`
// (imports) and function/method `calls`. No Python runtime required.

function toRel(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

const uriOf = (file: string) => pathToFileURL(file).href;

// --- import edges ---------------------------------------------------------

function* importPositions(root: TsNode): Generator<LspPosition> {
  for (const child of root.namedChildren) {
    if (!child) continue;
    if (child.type === "import_from_statement") {
      const m = child.childForFieldName("module_name");
      if (m) yield { line: m.startPosition.row, character: m.startPosition.column };
    } else if (child.type === "import_statement") {
      for (const part of child.namedChildren) {
        if (!part) continue;
        const nameNode = part.type === "aliased_import" ? (part.childForFieldName("name") ?? part) : part;
        if (nameNode.type === "dotted_name") {
          yield { line: nameNode.startPosition.row, character: nameNode.startPosition.column };
        }
      }
    }
  }
}

async function resolveImports(
  client: PyrightClient,
  parser: { parse(s: string): { rootNode: unknown } | null },
  rootDir: string,
  pyFiles: readonly string[],
): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const file of pyFiles) {
    const uri = uriOf(file);
    await client.waitForAnalysis(uri);
    const tree = parser.parse(fs.readFileSync(file, "utf8"));
    if (!tree) continue;
    const from = `py:${toRel(rootDir, file)}`;
    for (const pos of importPositions(tree.rootNode as TsNode)) {
      for (const def of await client.definition(uri, pos)) {
        const t = locationTarget(def);
        if (!t) continue;
        const to = pyAddressOfFile(rootDir, t.uri);
        if (!to || to === from) continue;
        const key = `${from}->${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from, to, type: "depends-on" });
      }
    }
  }
  return edges;
}

function pyAddressOfFile(rootDir: string, uri: string): string | undefined {
  let p: string;
  try {
    p = fileURLToPath(uri);
  } catch {
    return undefined;
  }
  const rel = toRel(rootDir, p);
  if (rel.startsWith("..") || !rel.endsWith(".py") || rel.includes("site-packages")) return undefined;
  return `py:${rel}`;
}

// --- call edges -----------------------------------------------------------

interface PyFunc {
  readonly address: string;
  readonly line: number;
  readonly node: TsNode;
}

function unwrapDef(node: TsNode): TsNode {
  return node.type === "decorated_definition" ? (node.childForFieldName("definition") ?? node) : node;
}

function collectFunctions(root: TsNode, rel: string): PyFunc[] {
  const out: PyFunc[] = [];
  for (const child of root.namedChildren) {
    if (!child) continue;
    const decl = unwrapDef(child);
    if (decl.type === "function_definition") {
      const name = decl.childForFieldName("name")?.text;
      if (name) out.push({ address: `py:${rel}#${name}`, line: decl.startPosition.row, node: decl });
    } else if (decl.type === "class_definition") {
      const className = decl.childForFieldName("name")?.text;
      const body = decl.childForFieldName("body");
      if (!className || !body) continue;
      for (const member of body.namedChildren) {
        if (!member) continue;
        const m = unwrapDef(member);
        if (m.type !== "function_definition") continue;
        const methodName = m.childForFieldName("name")?.text;
        if (methodName) out.push({ address: `py:${rel}#${className}.${methodName}`, line: m.startPosition.row, node: m });
      }
    }
  }
  return out;
}

function* descendantsOfType(node: TsNode, type: string): Generator<TsNode> {
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === type) yield child;
    yield* descendantsOfType(child, type);
  }
}

function calleePosition(callNode: TsNode): LspPosition | undefined {
  const fn = callNode.childForFieldName("function");
  if (!fn) return undefined;
  const target = fn.type === "attribute" ? (fn.childForFieldName("attribute") ?? fn) : fn;
  return { line: target.startPosition.row, character: target.startPosition.column };
}

async function resolveCalls(
  client: PyrightClient,
  parser: { parse(s: string): { rootNode: unknown } | null },
  rootDir: string,
  pyFiles: readonly string[],
): Promise<GraphEdge[]> {
  // Pass 1: parse all files, build the (file:line -> address) index.
  const cache: { uri: string; funcs: PyFunc[] }[] = [];
  const index = new Map<string, string>();
  for (const file of pyFiles) {
    const tree = parser.parse(fs.readFileSync(file, "utf8"));
    if (!tree) continue;
    const rel = toRel(rootDir, file);
    const funcs = collectFunctions(tree.rootNode as TsNode, rel);
    for (const f of funcs) index.set(`${rel}:${f.line}`, f.address);
    cache.push({ uri: uriOf(file), funcs });
  }

  // Pass 2: resolve each call's callee and look it up in the index.
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const { uri, funcs } of cache) {
    await client.waitForAnalysis(uri);
    for (const fn of funcs) {
      for (const call of descendantsOfType(fn.node, "call")) {
        const pos = calleePosition(call);
        if (!pos) continue;
        for (const def of await client.definition(uri, pos)) {
          const t = locationTarget(def);
          if (!t) continue;
          let targetPath: string;
          try {
            targetPath = fileURLToPath(t.uri);
          } catch {
            continue;
          }
          const to = index.get(`${toRel(rootDir, targetPath)}:${t.line}`);
          if (!to || to === fn.address) continue;
          const key = `${fn.address}->${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from: fn.address, to, type: "calls" });
        }
      }
    }
  }
  return edges;
}

// --- override edges (cross-file inheritance) ------------------------------

// FR-97 cross-file: a subclass method that redefines an inherited method emits an
// `overrides` edge to the base method, even when the base class lives in ANOTHER file
// (`class HTTPAdapter(BaseAdapter)` with BaseAdapter imported). The skeleton walker
// already resolves SAME-FILE inheritance by name; this uses Pyright to resolve the base
// class across files, then emits ONLY the cross-file edges (same-file are skipped so the
// two layers don't duplicate).

interface PyClass {
  readonly address: string;
  readonly line: number;
  readonly methods: Map<string, string>;
  readonly basePositions: readonly LspPosition[];
}

/** The position to resolve for a base-class expression: a bare `identifier`, or the last
 *  name of a dotted `module.Base` attribute. Subscripts (`Generic[T]`) etc. are skipped. */
function basePosition(base: TsNode): LspPosition | undefined {
  if (base.type === "identifier") return { line: base.startPosition.row, character: base.startPosition.column };
  if (base.type === "attribute") {
    const name = base.childForFieldName("attribute") ?? base;
    return { line: name.startPosition.row, character: name.startPosition.column };
  }
  return undefined;
}

function collectClasses(root: TsNode, rel: string): PyClass[] {
  const out: PyClass[] = [];
  for (const child of root.namedChildren) {
    if (!child) continue;
    const decl = unwrapDef(child);
    if (decl.type !== "class_definition") continue;
    const className = decl.childForFieldName("name")?.text;
    const body = decl.childForFieldName("body");
    if (!className || !body) continue;
    const address = `py:${rel}#${className}`;
    const methods = new Map<string, string>();
    for (const member of body.namedChildren) {
      if (!member) continue;
      const m = unwrapDef(member);
      if (m.type !== "function_definition") continue;
      const methodName = m.childForFieldName("name")?.text;
      if (methodName) methods.set(methodName, `${address}.${methodName}`);
    }
    const basePositions: LspPosition[] = [];
    for (const base of decl.childForFieldName("superclasses")?.namedChildren ?? []) {
      const pos = base ? basePosition(base) : undefined;
      if (pos) basePositions.push(pos);
    }
    out.push({ address, line: decl.startPosition.row, methods, basePositions });
  }
  return out;
}

interface ClassInfo {
  readonly methods: Map<string, string>;
  readonly basePositions: readonly LspPosition[];
  readonly uri: string;
}

/** The `py:file` prefix of a node address (everything before `#`), to tell same-file from cross-file. */
const fileOf = (address: string): string => address.split("#")[0];

/** Breadth-first up the resolved base chain (nearest first) for the first class that
 *  defines a method named `methodName`; returns that base method's address. Cycle-safe. */
function nearestBaseMethod(
  classAddress: string,
  methodName: string,
  info: ReadonlyMap<string, ClassInfo>,
  bases: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  const seen = new Set<string>([classAddress]);
  const queue = [...(bases.get(classAddress) ?? [])];
  while (queue.length > 0) {
    const b = queue.shift() as string;
    if (seen.has(b)) continue;
    seen.add(b);
    const hit = info.get(b)?.methods.get(methodName);
    if (hit) return hit;
    queue.push(...(bases.get(b) ?? []));
  }
  return undefined;
}

async function resolveOverrides(
  client: PyrightClient,
  parser: { parse(s: string): { rootNode: unknown } | null },
  rootDir: string,
  pyFiles: readonly string[],
): Promise<GraphEdge[]> {
  // Pass 1: parse all files; index each class by (file:line) and record its methods + bases.
  const classIndex = new Map<string, string>(); // "rel:line" -> classAddress
  const info = new Map<string, ClassInfo>();
  for (const file of pyFiles) {
    const tree = parser.parse(fs.readFileSync(file, "utf8"));
    if (!tree) continue;
    const rel = toRel(rootDir, file);
    const uri = uriOf(file);
    for (const cls of collectClasses(tree.rootNode as TsNode, rel)) {
      classIndex.set(`${rel}:${cls.line}`, cls.address);
      info.set(cls.address, { methods: cls.methods, basePositions: cls.basePositions, uri });
    }
  }

  // Pass 2: resolve each class's base-name positions to first-party base class addresses.
  const bases = new Map<string, string[]>();
  for (const [address, ci] of info) {
    await client.waitForAnalysis(ci.uri);
    const resolved: string[] = [];
    for (const pos of ci.basePositions) {
      for (const def of await client.definition(ci.uri, pos)) {
        const t = locationTarget(def);
        if (!t) continue;
        let p: string;
        try {
          p = fileURLToPath(t.uri);
        } catch {
          continue;
        }
        const baseAddr = classIndex.get(`${toRel(rootDir, p)}:${t.line}`);
        if (baseAddr && baseAddr !== address) resolved.push(baseAddr);
      }
    }
    bases.set(address, resolved);
  }

  // Pass 3: emit CROSS-FILE override edges only (same-file are the skeleton walker's job).
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const [address, ci] of info) {
    for (const [methodName, methodAddress] of ci.methods) {
      const baseMethod = nearestBaseMethod(address, methodName, info, bases);
      if (!baseMethod || baseMethod === methodAddress || fileOf(baseMethod) === fileOf(methodAddress)) continue;
      const key = `${methodAddress}->${baseMethod}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: methodAddress, to: baseMethod, type: "overrides" });
    }
  }
  return edges;
}

// --- public entry points --------------------------------------------------

async function withClient<T>(rootDir: string, pyFiles: readonly string[], fn: (c: PyrightClient) => Promise<T>): Promise<T> {
  const client = new PyrightClient(rootDir);
  await client.start();
  try {
    for (const file of pyFiles) client.didOpen(uriOf(file), fs.readFileSync(file, "utf8"));
    return await fn(client);
  } finally {
    client.dispose();
  }
}

export async function resolvePythonImportEdges(rootDir: string, files: readonly string[], wasmDir: string): Promise<GraphEdge[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) return [];
  const parser = await loadGrammar(wasmDir, "tree-sitter-python.wasm");
  return withClient(rootDir, pyFiles, (c) => resolveImports(c, parser, rootDir, pyFiles));
}

export async function resolvePythonCallEdges(rootDir: string, files: readonly string[], wasmDir: string): Promise<GraphEdge[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) return [];
  const parser = await loadGrammar(wasmDir, "tree-sitter-python.wasm");
  return withClient(rootDir, pyFiles, (c) => resolveCalls(c, parser, rootDir, pyFiles));
}

/** FR-97 cross-file override edges only (same-file are the skeleton walker's job). */
export async function resolvePythonOverrideEdges(rootDir: string, files: readonly string[], wasmDir: string): Promise<GraphEdge[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) return [];
  const parser = await loadGrammar(wasmDir, "tree-sitter-python.wasm");
  return withClient(rootDir, pyFiles, (c) => resolveOverrides(c, parser, rootDir, pyFiles));
}

/** All Python edge kinds with a single Pyright session (used by bootstrap). */
export async function resolvePythonEdges(rootDir: string, files: readonly string[], wasmDir: string): Promise<GraphEdge[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) return [];
  const parser = await loadGrammar(wasmDir, "tree-sitter-python.wasm");
  return withClient(rootDir, pyFiles, async (c) => [
    ...(await resolveImports(c, parser, rootDir, pyFiles)),
    ...(await resolveCalls(c, parser, rootDir, pyFiles)),
    ...(await resolveOverrides(c, parser, rootDir, pyFiles)),
  ]);
}
