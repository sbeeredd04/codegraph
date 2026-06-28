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

/** Both Python edge kinds with a single Pyright session (used by bootstrap). */
export async function resolvePythonEdges(rootDir: string, files: readonly string[], wasmDir: string): Promise<GraphEdge[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) return [];
  const parser = await loadGrammar(wasmDir, "tree-sitter-python.wasm");
  return withClient(rootDir, pyFiles, async (c) => [
    ...(await resolveImports(c, parser, rootDir, pyFiles)),
    ...(await resolveCalls(c, parser, rootDir, pyFiles)),
  ]);
}
