// Enforces architecture spine AD-1: the pure core imports nothing from vscode,
// fs, the network, an LLM SDK, or any adapter. A forbidden import fails the build.
//
// Any Node built-in that does I/O or reaches the host. Kept as one list so `core`
// (pure) and the standalone-runtime layers can share it. `node:`-prefixed and bare
// specifiers both covered; `os`/`crypto`/`process` are host access the pure core must
// stay clear of so it remains deterministic + portable to the source-blind plane.
const NODE_IO_MODULES =
  "^(fs|fs/promises|http|http2|https|net|tls|dns|dgram|child_process|cluster|" +
  "worker_threads|os|crypto|process|readline|repl|vm|inspector|zlib|perf_hooks|v8|" +
  "node:(fs|fs/promises|http|http2|https|net|tls|dns|dgram|child_process|cluster|" +
  "worker_threads|os|crypto|process|readline|repl|vm|inspector|zlib|perf_hooks|v8))$";

module.exports = {
  forbidden: [
    {
      name: "core-no-vscode",
      severity: "error",
      comment: "AD-1: src/core must not depend on the VS Code API.",
      from: { path: "^src/core" },
      // `^vscode$` = the ambient extension API only, NOT npm packages whose names
      // merely contain "vscode" (@vscode/tree-sitter-wasm, vscode-jsonrpc, …).
      to: { path: "^vscode$" },
    },
    {
      name: "core-no-node-io",
      severity: "error",
      comment: "AD-1: src/core must be pure — no fs/network/process/host I/O.",
      from: { path: "^src/core" },
      to: { path: NODE_IO_MODULES },
    },
    {
      name: "core-no-adapters",
      severity: "error",
      comment: "AD-1: src/core must not import from any adapter.",
      from: { path: "^src/core" },
      to: { path: "^src/adapters" },
    },
    {
      // The CLI, MCP server, board server, artifact I/O, and language adapters run as
      // STANDALONE Node processes (dist/cli.js, dist/mcp-server.js) — outside the VS
      // Code host, where the `vscode` module does not exist. Importing it there is a
      // runtime crash with no compile error, so forbid it. (`@vscode/tree-sitter-wasm`
      // is an ordinary npm package, not the extension API — excluded.)
      name: "runtime-no-vscode",
      severity: "error",
      comment: "Standalone-runtime code (CLI/MCP/serve/artifact/lang) must not import vscode.",
      from: {
        path: "^src/(cli|adapters/(mcp|serve|artifact|lang))",
        pathNot: "\\.(test|spec)\\.ts$",
      },
      to: { path: "^vscode$" }, // the ambient extension API only (see core-no-vscode)
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};
