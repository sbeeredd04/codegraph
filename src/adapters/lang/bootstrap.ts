import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodeGraph } from "../../core/graph/graph.js";
import {
  enabledFamilies,
  grammarForFile,
  isSourceFile,
  createAdapters,
  EDGE_RESOLVERS,
  type LanguageFamily,
} from "./registry.js";
import type { IngestEvent } from "../../core/ingest/progress.js";

// Polyglot whole-repo bootstrap (FR-1): tree-sitter skeletons for every TS/JS
// and Python file + accurate cross-file edges. Which extensions, which grammar,
// and which edge resolver are all data now — see the FR-86 registry. I/O lives
// here (adapter), never the core (AD-1).

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
  enabled: ReadonlySet<LanguageFamily>,
  acc: string[] = [],
): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dot-directories (.git, .claude, .bmad, .venv …): they hold
      // tooling, not the user's source, and scanning them pollutes the graph and
      // stalls the Python pass on unrelated scripts.
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      findSourceFiles(full, skip, enabled, acc);
    } else if (isSourceFile(entry.name, enabled)) {
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

  const enabled = enabledFamilies(options);
  const skip = new Set([...SKIP_DIRS, ...(options.exclude ?? [])]);
  emit({ phase: "discovering" });
  const adapters = await createAdapters(wasmDir, enabled);
  const files = await filterGitIgnored(rootDir, findSourceFiles(rootDir, skip, enabled));
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
      const grammar = grammarForFile(file, enabled);
      const adapter = grammar && adapters.get(grammar.id);
      if (!adapter) continue; // not source under the enabled families (already filtered)
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

  // Accurate cross-file edges per family (FR-86 registry): ts-morph resolves the
  // TS/JS family's imports/calls/JSX-renders over one shared Project; Pyright resolves
  // Python imports/calls. Each runs over ONLY its family's files and is best-effort —
  // a failing resolver leaves the tree-sitter skeleton standing.
  emit({ phase: "resolving", found: files.length, parsed, failed, nodes: graph.order, edges: graph.size });
  for (const resolver of EDGE_RESOLVERS) {
    if (!enabled.has(resolver.family)) continue;
    const familyFiles = files.filter((f) => grammarForFile(f, enabled)?.family === resolver.family);
    if (familyFiles.length === 0) continue;
    try {
      for (const edge of await resolver.resolve(rootDir, familyFiles, wasmDir)) graph.addEdge(edge);
    } catch {
      // best-effort per family
    }
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
