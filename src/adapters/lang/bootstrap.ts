import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Project } from "ts-morph";
import { CodeGraph } from "../../core/graph/graph.js";
import type { LanguageAdapter } from "../../core/ports.js";
import { createTypeScriptAdapter, createTsxAdapter } from "./typescript/index.js";
import { createPythonAdapter } from "./python/index.js";
import { resolveImportEdges, resolveCallEdges } from "./typescript/edges.js";
import { resolvePythonEdges } from "./python/pyright-edges.js";
import type { IngestEvent } from "../../core/ingest/progress.js";

// Polyglot whole-repo bootstrap (FR-1): tree-sitter skeletons for every TS/JS
// and Python file + ts-morph accurate edges for the TS files. I/O lives here
// (adapter), never the core (AD-1).

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "coverage", "fixtures", ".venv", "__pycache__"]);

export interface BootstrapCoverage {
  readonly found: number;
  readonly parsed: number;
  readonly failed: number;
  readonly skipped: readonly string[];
}

export interface BootstrapResult {
  readonly graph: CodeGraph;
  readonly coverage: BootstrapCoverage;
}

export interface BootstrapOptions {
  /** Default true. */
  readonly typescript?: boolean;
  /** Default true. */
  readonly python?: boolean;
  /** Extra directory names to skip (from the watch-scope setting). */
  readonly exclude?: readonly string[];
}

// FR-83: the TS/JS family we parse. `.tsx`/`.jsx`/`.js`/`.mjs`/`.cjs` were excluded
// before, so React-Native apps (JSX-in-.js, arrow components) went almost entirely
// unread. `.d.ts` (declarations) and test/spec files stay out — they aren't the app.
const TS_JS_EXTENSIONS = [".ts", ".tsx", ".jsx", ".js", ".mjs", ".cjs"];
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

function isSourceFile(name: string, ts: boolean, py: boolean): boolean {
  if (name.endsWith(".d.ts") || TEST_FILE.test(name)) return false;
  if (ts && TS_JS_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (py && name.endsWith(".py")) return true;
  return false;
}

/** FR-83: pick the grammar for a file. Plain `.ts` uses the TypeScript grammar (its
 *  `<T>value` type-assertion syntax would mis-parse under tsx.wasm); every JSX-bearing
 *  or plain-JS extension uses the tsx grammar (a JS+JSX+TS superset). */
function adapterFor(
  file: string,
  ts: LanguageAdapter,
  tsx: LanguageAdapter,
  py: LanguageAdapter,
): LanguageAdapter {
  if (file.endsWith(".py")) return py;
  if (file.endsWith(".ts")) return ts; // plain .ts only (.tsx does not end with .ts)
  return tsx; // .tsx .jsx .js .mjs .cjs
}

const execFileAsync = promisify(execFile);

/**
 * Drop git-ignored paths so the in-memory graph matches what a git baseline
 * worktree contains (tracked files only) — without this, gitignored tooling
 * (e.g. `_bmad/`, `.claude/`) inflates the working scan and shows up as phantom
 * "added" nodes when diffing against a ref. `ls-files --cached --others
 * --exclude-standard` is exactly "tracked + untracked-but-not-ignored". No-op
 * outside a git repo / when git is unavailable (the call throws → keep the walk).
 */
async function filterGitIgnored(rootDir: string, files: string[]): Promise<string[]> {
  if (files.length === 0) return files;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const allowed = new Set(stdout.split("\0").filter(Boolean).map((rel) => path.resolve(rootDir, rel)));
    if (allowed.size === 0) return files; // empty / bare repo — keep the raw walk
    return files.filter((f) => allowed.has(path.resolve(f)));
  } catch {
    return files;
  }
}

export function findSourceFiles(
  root: string,
  skip: ReadonlySet<string>,
  ts: boolean,
  py: boolean,
  acc: string[] = [],
): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dot-directories (.git, .claude, .bmad, .venv …): they hold
      // tooling, not the user's source, and scanning them pollutes the graph and
      // stalls the Python pass on unrelated scripts.
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      findSourceFiles(full, skip, ts, py, acc);
    } else if (isSourceFile(entry.name, ts, py)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Optional progress sink (FR-55) — the live-progress UI's data source. Called as
 * the scan walks → parses → resolves edges; emits ONLY counts + a repo-relative
 * current file (AD-16/AD-14: never source bytes / an absolute host path). It is a
 * per-CALL concern (not a BootstrapOptions setting): the extension's live scan
 * passes one to stream into the webview; the baseline/MCP scans omit it. Best
 * effort — a throwing sink never derails the scan.
 */
export type IngestProgress = (event: IngestEvent) => void;

export async function bootstrapRepo(
  rootDir: string,
  wasmDir: string,
  options: BootstrapOptions = {},
  onProgress?: IngestProgress,
): Promise<BootstrapResult> {
  // Wrap the sink so a buggy/throwing consumer can never crash ingestion.
  const emit: IngestProgress = (e) => {
    if (!onProgress) return;
    try {
      onProgress(e);
    } catch {
      /* progress is advisory — never let it derail the scan */
    }
  };

  const useTs = options.typescript !== false;
  const usePy = options.python !== false;
  const skip = new Set([...SKIP_DIRS, ...(options.exclude ?? [])]);
  emit({ phase: "discovering" });
  const tsAdapter: LanguageAdapter = await createTypeScriptAdapter(wasmDir);
  const tsxAdapter: LanguageAdapter = await createTsxAdapter(wasmDir);
  const pyAdapter: LanguageAdapter = await createPythonAdapter(wasmDir);
  const files = await filterGitIgnored(rootDir, findSourceFiles(rootDir, skip, useTs, usePy));
  const graph = new CodeGraph();
  const skipped: string[] = [];
  let parsed = 0;
  let failed = 0;
  emit({ phase: "discovering", found: files.length });

  // Throttle per-file ticks so a large repo posts at most ~100 parsing updates
  // (each crosses the host→webview boundary) instead of one per file.
  const step = Math.max(1, Math.ceil(files.length / 100));
  emit({ phase: "parsing", found: files.length, parsed: 0, nodes: 0, edges: 0 });
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    try {
      const source = fs.readFileSync(file, "utf8");
      const rel = path.relative(rootDir, file).split(path.sep).join("/");
      const adapter = adapterFor(file, tsAdapter, tsxAdapter, pyAdapter);
      const { nodes, edges } = adapter.parseFile(rel, source);
      for (const node of nodes) graph.addNode(node);
      for (const edge of edges) graph.addEdge(edge);
      parsed += 1;
      if (parsed % step === 0 || i === files.length - 1) {
        emit({
          phase: "parsing",
          found: files.length,
          parsed,
          failed,
          nodes: graph.order,
          edges: graph.size,
          file: path.relative(rootDir, file).split(path.sep).join("/"),
        });
      }
    } catch {
      failed += 1;
      skipped.push(path.relative(rootDir, file));
    }
  }

  // Accurate edges (ts-morph) over the TS/JS files: module `depends-on` plus
  // function/method `calls`. Python accurate edges (Pyright over LSP) follow below.
  emit({ phase: "resolving", found: files.length, parsed, failed, nodes: graph.order, edges: graph.size });
  try {
    const tsFiles = files.filter((f) => !f.endsWith(".py"));
    const project = new Project();
    for (const file of tsFiles) project.addSourceFileAtPath(file);
    for (const edge of resolveImportEdges(project, rootDir)) graph.addEdge(edge);
    for (const edge of resolveCallEdges(project, rootDir)) graph.addEdge(edge);
  } catch {
    // Edge resolution is best-effort; the skeleton still stands.
  }

  // Accurate Python edges (Pyright over LSP) — imports + calls; no-op for TS-only.
  try {
    for (const edge of await resolvePythonEdges(rootDir, files, wasmDir)) graph.addEdge(edge);
  } catch {
    // best-effort
  }

  emit({
    phase: "done",
    found: files.length,
    parsed,
    failed,
    nodes: graph.order,
    edges: graph.size,
  });
  return { graph, coverage: { found: files.length, parsed, failed, skipped } };
}
