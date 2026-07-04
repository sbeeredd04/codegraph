import * as path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { bootstrapRepo } from "../adapters/lang/bootstrap.js";
import { exportGraphSnapshot } from "../core/graph/export.js";
import { createBoardServer } from "../adapters/serve/server.js";

// FR-88 — the `npx codegraph` / `codegraph serve` one-liner. Scan the current
// working dir, then open the SAME board the extension + website render, with the
// live graph injected. The easy-distribution win: no VS Code, no install ceremony.
// Host-local + read-only (AD-16 / FR-9) — the scan reads source in place and the
// server hands the board a keepHostLocal snapshot (doc/examples are fine here: this
// runs on the user's own machine, unlike the source-blind cloud plane, AD-14).

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

async function main(): Promise<void> {
  // Usage: `codegraph [dir]` (defaults to cwd). CODEGRAPH_PORT overrides the port.
  const arg = process.argv[2];
  if (arg === "-h" || arg === "--help") {
    process.stderr.write("Usage: codegraph [dir]\n  Scans [dir] (default: cwd) and opens the graph board.\n");
    return;
  }
  const root = path.resolve(arg && arg !== "serve" ? arg : process.cwd());
  const port = Number(process.env.CODEGRAPH_PORT ?? 4319);

  process.stderr.write(`codegraph: scanning ${root} …\n`);
  const { graph, coverage } = await bootstrapRepo(root, wasmDir());
  const snapshot = exportGraphSnapshot(graph.allNodes(), graph.allEdges(), {
    keepHostLocal: true,
    root,
  });

  const server = createBoardServer({ exportDir: exportDir(), snapshot, editorRoot: root });
  server.on("error", (err: NodeJS.ErrnoException) => {
    const hint = err.code === "EADDRINUSE" ? ` (port ${port} in use — set CODEGRAPH_PORT)` : "";
    process.stderr.write(`codegraph: server error${hint}: ${err.message}\n`);
    process.exit(1);
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    process.stderr.write(
      `codegraph: ${coverage.parsed}/${coverage.found} files · ${graph.order} nodes · ${graph.size} edges\n` +
        `codegraph: board ready at ${url}  (Ctrl-C to stop)\n`,
    );
    openBrowser(url);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`codegraph failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
