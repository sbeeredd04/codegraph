const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

/** Two bundles: the extension host (node) and the webview client (browser). */
const builds = [
  {
    entryPoints: ["src/extension/index.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/extension.js",
    // vscode is provided by the host; tree-sitter-wasm stays external so its
    // runtime `require.resolve` finds the wasm assets in node_modules.
    external: ["vscode", "@vscode/tree-sitter-wasm"],
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
];

async function main() {
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
