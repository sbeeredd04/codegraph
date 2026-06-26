// Enforces architecture spine AD-1: the pure core imports nothing from vscode,
// fs, the network, an LLM SDK, or any adapter. A forbidden import fails the build.
module.exports = {
  forbidden: [
    {
      name: "core-no-vscode",
      severity: "error",
      comment: "AD-1: src/core must not depend on the VS Code API.",
      from: { path: "^src/core" },
      to: { path: "vscode" },
    },
    {
      name: "core-no-node-io",
      severity: "error",
      comment: "AD-1: src/core must not do I/O (fs, http, child_process, net).",
      from: { path: "^src/core" },
      to: { path: "^(fs|node:fs|http|node:http|https|child_process|node:child_process|net|node:net)$" },
    },
    {
      name: "core-no-adapters",
      severity: "error",
      comment: "AD-1: src/core must not import from any adapter.",
      from: { path: "^src/core" },
      to: { path: "^src/adapters" },
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
