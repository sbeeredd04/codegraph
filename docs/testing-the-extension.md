# Testing the codegraph VS Code extension

The extension is functionally complete: it pulls source into a live graph, points
at the file:line behind every node, and opens/reveals those files in your real
editor (FR-31). This guide is how **you** verify that flow on your own machine —
the Extension Development Host cannot be driven headlessly, so the automated gate
proves the code compiles/bundles/packages and unit-tests the safeguards, but the
live click-through is yours to confirm.

## Two ways to run it

### A. Install the packaged .vsix (closest to what a user gets)

```bash
npm run package          # rebuilds the bundle, then writes codegraph-0.0.1.vsix (~19 MB)
code --install-extension codegraph-0.0.1.vsix
# then: Reload Window (Cmd+Shift+P → "Developer: Reload Window")
```

`npm run package` runs `vscode:prepublish` first, so the .vsix always carries the
latest frontend export (the 3D board included). To uninstall:
`code --uninstall-extension codegraph.codegraph`.

### B. Run from source (fastest iteration)

Open this repo in VS Code and press **F5** (Run → Start Debugging). A second
"Extension Development Host" window launches with the extension loaded from
`dist/`. Rebuild bundles with `npm run build` (or `npm run watch`) and reload the
host window to pick up changes.

## The flow to verify (pull source → point at files → open files)

1. In the host window, open a real project folder (this repo works — it is TS with
   some Python).
2. `Cmd+Shift+P` → **"codegraph: Open Workspace Graph"**. Watch the progress
   notification; it ends with `N/M files · X nodes · Y edges · watching for changes`.
   That is the *pull-source* step — codegraph parsed your workspace into the graph.
3. `Cmd+Shift+P` → **"codegraph: Open Unified Explorer (preview)"** for the full
   2D/3D dashboard (the board you have been reviewing). Toggle **3D** — confirm the
   T8.1 fix (no blank-white crash) and the T8.4 look (matte nodes, visible edges).
4. Click any node. The detail panel names its **file:line** — that is *point at
   files*.
5. In the node's source affordance, use **Open / reveal in editor**. codegraph
   posts only the repo-relative path; the host resolves it against the workspace
   root and runs `showTextDocument`, opening the real file at the right line —
   that is *open files*. (In the extension the webview never renders source bytes
   inline by design — AD-16 keeps source host-local and deep-links to your editor,
   which is right there.)

If steps 2, 4 and 5 work well, the extension earns its place alongside the
`uv tool install` path (the FR-73 distribution decision).

## Test the AI / MCP connection

1. `Cmd+Shift+P` → **"codegraph: Copy MCP Config"**. It copies a config that points
   your agent at `dist/mcp-server.js <repoRoot>` and offers **Show config**.
2. Paste it into your agent's MCP settings (Claude Code: `.mcp.json` or
   `claude mcp add`), then start a session in the same repo.
3. Ask the agent to call a codegraph tool — e.g. *"use codegraph graph_stats"* or
   *"describe_node for the ExplorerPanel class"*. A grounded answer citing real
   nodes confirms the round-trip. The MCP server is a standalone bundled Node
   process (no editor, no LLM key — your agent is the moat).

## What the automated gate already proves

- `npm run verify` — typecheck + import-boundary (dependency-cruiser) + 639 unit
  tests (incl. `src/extension/package-manifest.test.ts`, which pins the packaging
  invariants) + the esbuild bundle.
- The `.vsix` was integrity-checked to contain every load-bearing runtime file
  (`dist/extension.js`, `dist/mcp-server.js`, `media/explorer/index.html`,
  `pyright/langserver.index.js`, `ajv` runtime, `ts-morph`, `@vscode/tree-sitter-wasm`,
  `vscode-jsonrpc`) and to exclude all source, the frontend workspace, test
  fixtures, bundled-only libs, and sourcemaps.

## Notes / follow-ups

- **Size**: ~19 MB packed. The floor is pyright's bundled langserver (~34 MB
  unpacked) + ts-morph + the MCP SDK/ajv — all genuinely required at runtime.
- **LICENSE**: vsce warns none is present. Not needed to install locally; add one
  before any Marketplace publish (an ownership decision, deliberately left to you).
- **Marketplace publish** is a separate step (`vsce publish`) needing a publisher
  token — out of scope for local testing.
