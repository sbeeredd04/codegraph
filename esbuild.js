const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const watch = process.argv.includes("--watch");

/** Four bundles: the extension host (node), the in-editor webview client (browser),
 * the standalone MCP server (node), and the standalone web viewer (browser). main()
 * additionally stages the Mermaid vendor and the Next.js explorer export
 * (frontend/out -> media/explorer) — see the copy* helpers below. */
const builds = [
  {
    entryPoints: ["src/extension/index.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/extension.js",
    // vscode is provided by the host; tree-sitter-wasm stays external so its
    // runtime `require.resolve` finds the wasm assets; ts-morph wraps the TS
    // compiler and must not be bundled into the extension.
    external: ["vscode", "@vscode/tree-sitter-wasm", "ts-morph", "pyright", "vscode-jsonrpc"],
    sourcemap: true,
    logLevel: "info",
  },
  {
    entryPoints: ["webview/main.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: "media/webview.js",
    sourcemap: true,
    logLevel: "info",
  },
  {
    // Standalone MCP server (FR-13): `node dist/mcp-server.js <repoRoot>`.
    // Same native externals as the extension; the @modelcontextprotocol SDK and
    // zod are bundled in.
    entryPoints: ["src/adapters/mcp/index.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/mcp-server.js",
    external: ["@vscode/tree-sitter-wasm", "ts-morph", "pyright", "vscode-jsonrpc"],
    sourcemap: true,
    logLevel: "info",
  },
  {
    // Standalone web viewer (Epic 6): open dist/web/viewer.html, load a snapshot
    // exported from the panel. Self-contained IIFE so it runs from file:// — no
    // server, no editor.
    entryPoints: ["web/viewer.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: "dist/web/viewer.js",
    sourcemap: true,
    logLevel: "info",
  },
];

/** Ship the viewer's static HTML shell alongside its bundle. */
function copyViewerHtml() {
  const out = path.join(__dirname, "dist", "web");
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "web", "viewer.html"), path.join(out, "viewer.html"));
}

// Vendor Mermaid for the agent-authored diagrams (Epic 7). We ship the prebuilt,
// fully self-contained global build (mermaid.min.js — already esbuild-bundled by
// the package, with zero runtime dynamic import()s) and load it via a <script>
// tag rather than bundling it into our IIFEs, which would re-introduce the very
// dynamic imports the webview CSP forbids. It exposes window.__esbuild_esm_mermaid_nm.mermaid.
function copyMermaid() {
  const src = path.join(__dirname, "node_modules", "mermaid", "dist", "mermaid.min.js");
  for (const dir of [path.join(__dirname, "media"), path.join(__dirname, "dist", "web")]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, path.join(dir, "mermaid.min.js"));
  }
}

// Bundle the Next.js static export (the unified explorer surface, Epic 7.4) into
// the extension under media/explorer, so the webview can mount the SAME app the
// web serves. The export is produced by `npm --prefix frontend run build` (run it
// via `npm run build:explorer`). When it is absent — a core-only build — we skip
// it, and the codegraph.openExplorer command degrades to a "not bundled" message.
function copyExplorerExport() {
  const src = path.join(__dirname, "frontend", "out");
  const dest = path.join(__dirname, "media", "explorer");
  if (!fs.existsSync(path.join(src, "index.html"))) {
    console.log(
      "[explorer] frontend/out not found — skipping (run `npm run build:explorer` to bundle the unified explorer).",
    );
    return;
  }
  // Replace wholesale so a stale prior export never lingers in the bundle.
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log("[explorer] bundled frontend/out -> media/explorer");
}

async function main() {
  copyViewerHtml();
  copyMermaid();
  copyExplorerExport();
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
