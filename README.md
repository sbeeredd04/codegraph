# codegraph

A live semantic knowledge graph of your codebase, beside your editor.

codegraph builds an in-memory graph of what your code *is* and how it *connects* —
modules, classes, functions, methods, and the calls and dependencies between them —
and keeps it live as you (and your AI agents) work. It is built for a world where
more and more code is written by agents: the graph is how you stay oriented, see
what changed, and hand your agent a structured view of the codebase it can query.

> Status: early and under active development (`v0.0.1`). The VS Code extension,
> the MCP server, and the standalone web viewer all work today.

## Why

As agents write more of the code, the bottleneck shifts from *writing* to *staying
oriented*: knowing what exists, what just changed, and what a change puts at risk.
codegraph answers that with three ideas:

- **A live map.** A semantic graph that updates in the background as files change,
  so the picture is never stale.
- **Change-awareness.** It highlights exactly what changed and ranks it by blast
  radius, so a large diff becomes a short, triaged list.
- **An agent-facing surface (the moat).** The same graph is exposed to your own AI
  agent over MCP, so the agent can query structure, impact, and dependencies — and
  write back its understanding of a node — without re-reading the whole repo.

## Principles

- **Local-first and in-memory.** The graph lives in your process. Nothing is sent
  anywhere.
- **Read-only.** The board never mutates your source. Git baselines are
  materialized in a detached worktree; annotations write graph metadata only, never
  code.
- **Bring your own agent.** There is no API key in the editor. LLM work is done by
  *your* Claude Code (or other MCP client) through the MCP tools — codegraph caches
  and displays what the agent writes.
- **Polyglot, no extra runtimes.** TypeScript / JavaScript via ts-morph and Python
  via Pyright over LSP — no Python interpreter required.
- **Hexagonal architecture.** A pure core with zero I/O dependencies, surrounded by
  thin adapters. The boundary is enforced in CI.

## Features

### The graph panel
- Four **projections** of one model — Full, Dependency, Structure, Call (FR-4).
- A **capability card** on hover: what a node is, the agent's annotation, and its
  edges grouped by relation (FR-11).
- **Semantic-zoom level-of-detail** so large graphs stay legible when zoomed out
  (FR-5).
- A restrained dark design system: nodes colored by semantic kind, stable
  force-directed layout that does not jump on live updates.

### Reading large graphs
- **Neighbour focus** (FR-25): click a node to lift it and its first-degree
  neighbours and dim the rest — the lens repaints without relaying out the graph.
- **Folder clustering** (FR-26): gather same-folder nodes into spatial pockets with
  convex-hull **territory outlines** and folder labels, sorted by path or size — a 2D
  affordance toggled from the topbar.

### Change awareness
- A **live watch loop** that coalesces save bursts and re-scans in the background,
  repainting only on a real change.
- A **change-diff overlay** (added / changed / moved, recolored) with a delta badge.
- **Diff against any git ref** (HEAD, a branch, a tag) to see what changed since.
- A **ranked change feed** that scores each change by blast radius (reverse
  reachability) — click a row to fly the camera to the node.

### Dead-code awareness
- **Orphan detection** (FR-12): nodes with no inbound references are flagged as
  dead-code candidates on the capability card, and a topbar **Orphans** overlay dims
  everything else so you can review them all at once. The wording stays honest — a
  candidate, since an orphan can also be a legitimate entry point.

### Knowledge on the board
- **Diagrams** (FR-28): the Mermaid diagrams your agent authors (architecture,
  workflow, sequence, dataflow) render in a drawer grouped by category, with "related
  node" chips that jump back into the graph. Rendered with `securityLevel: "strict"` —
  agent-authored content is untrusted.
- **Docs** (FR-29): the Markdown docs your agent writes render alongside, sanitized
  against a strict allowlist; `codegraph://node/<address>` links cross-highlight the
  graph instead of navigating away.

### Ask your own agent (FR-30)
- The **Ask** panel turns your question plus the selected node's context into a
  ready-to-run prompt for *your* connected agent — grounded in the real graph via the
  MCP query tools, and told to capture findings as a diagram or doc. codegraph builds
  the prompt; it holds no LLM key and makes no model call. That is the moat.

### Agent co-pilot — driving the board (Epic 19)
- **Overlays** (FR-37): the notes, marks (bug / breakpoint / issue / todo / hotspot),
  and groups your agent pins onto nodes and edges appear on the board — its durable
  memory *about* the code, never the code itself.
- **Live driving** (FR-39): with the board open, the agent can highlight nodes and
  paths, fly the camera, switch projection, open panels, and toggle overlays — and a
  **preempt banner** always lets you take the wheel back.
- **Guided tours and trace replay** (FR-40 / FR-41): walk an ordered node sequence
  over time — hand-picked, or extracted from a stack trace.
- **Onboarding playbook** (FR-42): a done/todo **Setup** checklist (shared with the
  `codegraph_onboard` MCP tool) that walks a fresh repo from indexing to a first set
  of diagrams, docs, and notes.

### Jump to the source (FR-31 / FR-32)
- Open a node's file at the right line in your editor — a native reveal inside the
  extension, and a `vscode://file` deep link from the standalone web view. Paths stay
  relative and host-local; no source bytes or absolute host paths ever leave the host.

### The dashboard (FR-34)
- Collapsible, resizable docks and floating inset panels for the source viewer and the
  knowledge drawers, with the layout persisted per browser — never written to the
  snapshot.

### Connect your AI agent (MCP)
- A standalone MCP server exposes the graph to your agent over stdio. Beyond the
  read-only query tools (below), the agent can write back durable knowledge —
  annotations, Mermaid diagrams, Markdown docs, and pinned notes / marks / groups —
  and drive the live board (highlight, focus, replay a stack trace, run a guided
  tour). One command copies the client config to connect it.
- The **knowledge loop**: your agent annotates a node, draws a diagram, or writes a
  doc; codegraph caches it and shows it on the board. No key in the editor.

### Export and the standalone viewer
- **Export** a portable, versioned JSON snapshot of the graph (nodes, edges, and the
  agent's knowledge — annotations, diagrams, docs, and overlays) — a shareable,
  diffable artifact.
- A **standalone web viewer** (`dist/web/viewer.html`) opens a snapshot with no
  editor and no server (it runs from `file://`): graph, projections, the capability
  card, the orphan overlay, and drag-and-drop loading.

## Commands

Run from the Command Palette.

| Command | What it does |
| --- | --- |
| `codegraph: Open Workspace Graph` | Build the graph for the workspace and start watching for changes. |
| `codegraph: Open Graph Panel (active file)` | Graph just the active file. |
| `codegraph: Refresh & Diff (show what changed)` | Re-scan and show what changed since the last view. |
| `codegraph: Diff Against Git Ref (HEAD, branch, tag)` | Diff the working tree against a git ref. |
| `codegraph: Copy MCP Config (connect your AI agent)` | Copy the MCP client config for this workspace. |
| `codegraph: Export Graph Snapshot (portable JSON)` | Write a portable JSON snapshot for sharing or the web viewer. |

## MCP tools

The MCP server is read-only over your *source*. Every write tool records graph
metadata only — annotations, diagrams, docs, and overlays — or drives the live view;
none ever edits a file.

**Query (read-only):**

| Tool | Purpose |
| --- | --- |
| `find_nodes` | Search nodes by name and kind. |
| `describe_node` | A node's detail plus any stored annotation. |
| `dependencies` | What a node depends on (forward edges). |
| `find_path` | How one node reaches another — the shortest dependency chain, to trace a request or data flow. |
| `blast_radius` | What depends on a node (reverse reachability) — the impact of changing it. |
| `neighborhood` | A local BFS map around a node, to a given radius. |
| `list_orphans` | Dead-code candidates — nodes with no inbound references. |
| `graph_stats` | Counts and a summary of the graph. |
| `recent_changes` | The ranked, blast-radius-scored feed of what changed vs a git ref (default HEAD). |

**Write knowledge (metadata only; cached and shown on the board):**

| Tool | Purpose |
| --- | --- |
| `annotate_node` | Record a node's summary / intent / role. |
| `save_diagram` · `list_diagrams` · `delete_diagram` | Author Mermaid diagrams (architecture / workflow / sequence / dataflow). |
| `save_doc` · `list_docs` · `delete_doc` | Author Markdown docs that render on the board. |
| `pin_note` · `annotate_edge` | Pin a free-form note to a node or an edge. |
| `mark_node` · `group_nodes` | Flag a node (bug / breakpoint / issue / todo / hotspot) or group nodes under a label. |
| `list_overlays` · `remove_overlay` | List or remove the notes, marks, and groups. |

**Drive the live board (ephemeral — the agent's hands on the wheel):**

| Tool | Purpose |
| --- | --- |
| `highlight_nodes` · `highlight_path` | Light up nodes or a path on the open board. |
| `focus_camera` · `set_projection` | Fly the camera to nodes, or switch projection. |
| `open_panel` · `toggle_affordance` | Open a panel, or toggle an overlay (orphans, folders, trace). |
| `guided_tour` · `replay_trace` | Walk an ordered node sequence — hand-picked, or extracted from a stack trace. |
| `codegraph_onboard` | A done/todo bootstrap playbook: index the repo and author the starter diagrams, docs, and notes. |

### Connecting your agent

1. Run `codegraph: Copy MCP Config` and paste it into your agent's MCP settings.
   It points the client at `dist/mcp-server.js` for this workspace.
2. Your agent can now query the graph — and call `annotate_node` to write back what a
   node is. Those annotations appear on the board's capability card on the next
   repaint. The server and the editor meet at a shared per-repo cache file, so no API
   key ever lives in the editor.

You can also run the server directly:

```bash
node dist/mcp-server.js /path/to/repo
```

## Architecture

codegraph is hexagonal (ports and adapters):

- **`src/core/`** — the pure core: the canonical node/edge schema, the in-memory
  graph, projections, diff, reachability, the change feed, and the semantic
  (annotation) engine. It imports no `vscode`, no filesystem, no network, no model
  SDK. This is enforced in CI by dependency-cruiser (`lint:boundaries`).
- **`src/adapters/`** — thin adapters around the core: language parsing
  (`lang/`), the git baseline (`git/`), the MCP server (`mcp/`), the annotation
  cache and provider (`semantic/`), and the webview surface (`surfaces/`).
- **`src/extension/`** — the VS Code extension host, which is the composition root
  that wires adapters to the core.
- **`webview/`** and **`web/`** — the in-editor webview client and the standalone web
  viewer, both built by esbuild.

The build emits four bundles: the extension host, the in-editor webview, the
standalone MCP server, and the standalone web viewer.

## Development

```bash
npm install
npm run build      # bundle the extension, webview, MCP server, and web viewer
npm run watch      # rebuild on change
npm run verify     # the full gate: typecheck + boundary lint + tests + build
npm test           # run the test suite (vitest)
npm run mcp -- /path/to/repo   # run the MCP server against a repo
```

`npm run verify` is the gate every change must pass: TypeScript typecheck, the
hexagonal boundary lint, the test suite, and a clean build.

## Project layout

```
src/
  core/         pure domain: graph, diff, reachability, change feed, semantic engine
  adapters/     lang (ts-morph, pyright), git, mcp, semantic, surfaces (webview)
  extension/    VS Code host (composition root)
webview/        in-editor graph client (Sigma / graphology)
web/            standalone snapshot viewer
```

## License

See repository for license details.
