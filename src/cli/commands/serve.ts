import { bootstrapRepo, newestSourceMtimeMs } from "../../adapters/lang/bootstrap.js";
import { exportGraphSnapshot, type GraphSnapshot } from "../../core/graph/export.js";
import { decideGraphSource } from "../../core/report/artifact-source.js";
import { readGraphArtifact } from "../../adapters/artifact/read.js";
import { createBoardServer } from "../../adapters/serve/server.js";
import {
  wasmDir,
  exportDir,
  resolveRoot,
  openBrowser,
  type CliCommand,
} from "../runtime.js";

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
  // Bind to loopback by default: the board carries the user's private graph + host-local
  // paths (AD-16), so it must not be reachable from the LAN. CODEGRAPH_HOST overrides
  // (e.g. "0.0.0.0" for a container the user deliberately exposes).
  const host = process.env.CODEGRAPH_HOST ?? "127.0.0.1";

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
  server.listen(port, host, () => {
    const url = `http://localhost:${port}/`;
    process.stderr.write(
      `codegraph: ${summary}\n` + `codegraph: board ready at ${url}  (Ctrl-C to stop)\n`,
    );
    openBrowser(url);
  });
}

// The default command: `codegraph [dir]` and `codegraph serve [dir]` both land here.
export const serveCommand: CliCommand = {
  name: "serve",
  usage: "codegraph serve [dir] [--from-artifact] [--rescan]",
  summary: "scan [dir] (default: cwd) and open the graph board",
  run: (inv) =>
    runServe(resolveRoot(inv), {
      fromArtifact: inv.flags.has("--from-artifact"),
      rescan: inv.flags.has("--rescan"),
    }),
};
