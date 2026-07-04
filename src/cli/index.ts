import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { bootstrapRepo, newestSourceMtimeMs } from "../adapters/lang/bootstrap.js";
import { CodeGraph } from "../core/graph/graph.js";
import { exportGraphSnapshot, type GraphSnapshot } from "../core/graph/export.js";
import { buildGraphArtifact } from "../core/report/artifact.js";
import { decideGraphSource } from "../core/report/artifact-source.js";
import { answerQuestion, renderAnswer } from "../core/query/answer.js";
import { buildAgentSkill, AGENT_SKILL_NAME } from "../core/skill/agent-skill.js";
import { writeGraphArtifact } from "../adapters/artifact/write.js";
import { readGraphArtifact } from "../adapters/artifact/read.js";
import { createBoardServer } from "../adapters/serve/server.js";

// The `codegraph` CLI. Two subcommands, both host-local + read-only (AD-16 / FR-9):
//   codegraph [dir]         scan + open the board (FR-88 — the easy-distribution win)
//   codegraph serve [dir]   same, explicit
//   codegraph graph [dir]   scan + write a durable .codegraph/ artifact (FR-91 —
//                           graph.json + GRAPH_REPORT.md the agent + website both read)
// The scan reads source in place and keeps host-local doc/examples: this runs on the
// user's own machine, unlike the source-blind cloud plane (AD-14).

const require = createRequire(__filename);

/** The tree-sitter grammar directory (`@vscode/tree-sitter-wasm`), resolved at
 *  runtime so the wasm assets ship with the dependency, not the bundle. */
function wasmDir(): string {
  return path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
}

/** The bundled Next export. `dist/cli.js` sits beside `media/` in the package, so
 *  the board is one level up from this bundle. */
function exportDir(): string {
  return path.join(__dirname, "..", "media", "explorer");
}

/** Open the board in the default browser (best-effort — a headless box just prints
 *  the URL and the server keeps running). */
function openBrowser(url: string): void {
  if (process.env.CODEGRAPH_NO_OPEN) return; // headless / CI / smoke tests
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* best-effort — never fail the serve because a browser couldn't be launched */
  }
}

const HELP =
  "Usage: codegraph [command] [dir]\n" +
  "  codegraph [dir]         scan [dir] (default: cwd) and open the graph board\n" +
  "  codegraph serve [dir]   same as above, explicit\n" +
  "     --from-artifact      load .codegraph/graph.json without scanning (even if stale)\n" +
  "     --rescan             ignore any .codegraph/ artifact and scan fresh\n" +
  "  codegraph graph [dir]   scan [dir] and write a durable .codegraph/ artifact\n" +
  "                          (graph.json + GRAPH_REPORT.md) for the agent + website\n" +
  "  codegraph query \"<q>\"   answer a question from .codegraph/graph.json, grounded\n" +
  "                          (e.g. \"what calls login\") — run `codegraph graph .` first\n" +
  "  codegraph skill         print the codegraph agent skill (SKILL.md) to stdout\n" +
  "  codegraph skill --install   install it to ~/.claude/skills/codegraph/SKILL.md\n" +
  "  CODEGRAPH_PORT overrides the serve port (default 4319).\n";

/** FR-92: emit the codegraph agent skill so a connected agent reaches for the graph
 *  before it greps. Prints to stdout by default (pipe it anywhere); `--install`
 *  writes it under the user's ~/.claude/skills (they ran the command, so they consent). */
function runSkill(install: boolean): void {
  const markdown = buildAgentSkill();
  if (!install) {
    process.stdout.write(markdown);
    return;
  }
  const dir = path.join(os.homedir(), ".claude", "skills", AGENT_SKILL_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "SKILL.md");
  fs.writeFileSync(target, markdown, "utf8");
  process.stderr.write(`codegraph: installed agent skill to ${target}\n`);
}

/** FR-95: answer a natural-language question from the persisted `.codegraph/graph.json`
 *  — the single model-friendly entry (graphify's `query`). No scan: reads the artifact,
 *  rebuilds the graph, and prints a grounded answer with file:line citations. */
function runQuery(root: string, question: string): void {
  if (!question.trim()) {
    process.stderr.write('codegraph: usage: codegraph query "<question>"\n');
    process.exitCode = 1;
    return;
  }
  const loaded = readGraphArtifact(root);
  if (!loaded) {
    process.stderr.write(
      "codegraph: no .codegraph/graph.json here — run `codegraph graph .` first to build it.\n",
    );
    process.exitCode = 1;
    return;
  }
  const graph = new CodeGraph();
  for (const node of loaded.snapshot.nodes) graph.addNode(node);
  for (const edge of loaded.snapshot.edges) graph.addEdge(edge);
  process.stdout.write(`${renderAnswer(answerQuestion(graph, question))}\n`);
}

/** FR-91: scan and persist the `.codegraph/` artifact — the agent + website handoff. */
async function runGraph(root: string): Promise<void> {
  process.stderr.write(`codegraph: scanning ${root} …\n`);
  const { graph, coverage } = await bootstrapRepo(root, wasmDir());
  const artifact = buildGraphArtifact(graph.allNodes(), graph.allEdges(), {
    root,
    generatedAt: new Date().toISOString(),
  });
  const outDir = writeGraphArtifact(root, artifact);
  process.stderr.write(
    `codegraph: ${coverage.parsed}/${coverage.found} files · ${graph.order} nodes · ${graph.size} edges\n` +
      `codegraph: wrote graph.json + GRAPH_REPORT.md to ${outDir}\n`,
  );
}

interface ServeOptions {
  /** `--from-artifact`: serve the persisted graph without scanning. */
  readonly fromArtifact?: boolean;
  /** `--rescan`: ignore any artifact and scan fresh. */
  readonly rescan?: boolean;
}

/** FR-88 + FR-93: serve the board with a snapshot injected. Prefers a persisted
 *  `.codegraph/graph.json` (the graph the agent already produced — no re-scan) and
 *  auto-rescans when it's missing or stale, so both the agent and the board read the
 *  same folder. Flags pin the choice. */
async function runServe(root: string, opts: ServeOptions = {}): Promise<void> {
  const port = Number(process.env.CODEGRAPH_PORT ?? 4319);

  // FR-93: decide artifact-vs-scan before doing either. Reading the artifact is cheap;
  // the freshness stat-walk only runs when an artifact is actually in play.
  const loaded = opts.rescan ? null : readGraphArtifact(root);
  const decision = decideGraphSource({
    artifactAvailable: loaded !== null,
    forceArtifact: opts.fromArtifact,
    forceRescan: opts.rescan,
    artifactMtimeMs: loaded?.mtimeMs,
    newestSourceMtimeMs: loaded ? newestSourceMtimeMs(root) : undefined,
  });

  let snapshot: GraphSnapshot;
  let summary: string;
  if (decision.mode === "artifact" && loaded) {
    snapshot = loaded.snapshot;
    summary = `${snapshot.nodeCount} nodes · ${snapshot.edgeCount} edges (.codegraph/graph.json)`;
    process.stderr.write(`codegraph: ${decision.reason}\n`);
  } else {
    if (opts.fromArtifact && !loaded) {
      process.stderr.write("codegraph: --from-artifact set but no readable .codegraph/graph.json\n");
    }
    process.stderr.write(`codegraph: ${decision.reason}\n`);
    const { graph, coverage } = await bootstrapRepo(root, wasmDir());
    snapshot = exportGraphSnapshot(graph.allNodes(), graph.allEdges(), {
      keepHostLocal: true,
      root,
    });
    summary = `${coverage.parsed}/${coverage.found} files · ${graph.order} nodes · ${graph.size} edges`;
  }

  const server = createBoardServer({ exportDir: exportDir(), snapshot, editorRoot: root });
  server.on("error", (err: NodeJS.ErrnoException) => {
    const hint = err.code === "EADDRINUSE" ? ` (port ${port} in use — set CODEGRAPH_PORT)` : "";
    process.stderr.write(`codegraph: server error${hint}: ${err.message}\n`);
    process.exit(1);
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    process.stderr.write(
      `codegraph: ${summary}\n` + `codegraph: board ready at ${url}  (Ctrl-C to stop)\n`,
    );
    openBrowser(url);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const positionals = argv.filter((a) => !a.startsWith("-"));
  const [sub, maybeDir] = positionals;
  if (flags.has("-h") || flags.has("--help")) {
    process.stderr.write(HELP);
    return;
  }
  if (sub === "skill") {
    runSkill(flags.has("--install"));
    return;
  }
  if (sub === "query") {
    // Everything after `query` is the question (so it works quoted or bare).
    runQuery(path.resolve(process.cwd()), positionals.slice(1).join(" "));
    return;
  }
  // `graph`/`serve` are subcommands; anything else in the first slot is the dir.
  const isSubcommand = sub === "graph" || sub === "serve";
  const root = path.resolve((isSubcommand ? maybeDir : sub) ?? process.cwd());
  if (sub === "graph") return runGraph(root);
  return runServe(root, { fromArtifact: flags.has("--from-artifact"), rescan: flags.has("--rescan") });
}

main().catch((err: unknown) => {
  process.stderr.write(`codegraph failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
