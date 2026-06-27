import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadGrammar, type TsNode } from "../skeleton.js";
import { PyrightClient, type LspPosition } from "./pyright-client.js";
import type { GraphEdge } from "../../../core/graph/types.js";

// Accurate Python edges (AD-9) via Pyright over LSP. v1 covers module-level
// `depends-on` (imports); Python `calls` edges are the next refinement.

function toRel(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

/** Positions to query for definition — the module name of each import. */
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

export async function resolvePythonImportEdges(
  rootDir: string,
  files: readonly string[],
  wasmDir: string,
): Promise<GraphEdge[]> {
  const pyFiles = files.filter((f) => f.endsWith(".py"));
  if (pyFiles.length === 0) return [];

  const parser = await loadGrammar(wasmDir, "tree-sitter-python.wasm");
  const client = new PyrightClient(rootDir);
  await client.start();

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const uriOf = (file: string) => pathToFileURL(file).href;

  try {
    for (const file of pyFiles) client.didOpen(uriOf(file), fs.readFileSync(file, "utf8"));

    for (const file of pyFiles) {
      const uri = uriOf(file);
      await client.waitForAnalysis(uri);
      const tree = parser.parse(fs.readFileSync(file, "utf8"));
      if (!tree) continue;
      const from = `py:${toRel(rootDir, file)}`;

      for (const pos of importPositions(tree.rootNode as unknown as TsNode)) {
        const defs = await client.definition(uri, pos);
        for (const def of defs) {
          const target = def.uri ?? def.targetUri;
          if (!target) continue;
          let targetPath: string;
          try {
            targetPath = fileURLToPath(target);
          } catch {
            continue;
          }
          const rel = toRel(rootDir, targetPath);
          if (rel.startsWith("..") || !rel.endsWith(".py") || rel.includes("site-packages")) continue;
          const to = `py:${rel}`;
          if (to === from) continue;
          const key = `${from}->${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({ from, to, type: "depends-on" });
        }
      }
    }
  } finally {
    client.dispose();
  }
  return edges;
}
