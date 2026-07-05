---
title: Getting started
order: 1
summary: Install codegraph, build the graph for a repository, and open it in the terminal, the VS Code extension, or your own AI agent over MCP.
---

# Getting started

codegraph maps a codebase into a live, navigable graph — in your terminal, beside
your editor, or handed to the AI agent you already use. It reads your code and
never writes to it, and your source never leaves your machine. This guide takes you
from nothing installed to a working map.

## Prerequisites

- **Node.js 20 or newer** — codegraph is a Node program. `node --version` should
  print `v20` or higher.
- **git** — to clone the repository (and to power the diff views).
- **Python 3.9+** — optional, only for the `pip install codegraph` path below.

No account, no sign-up, no API key. codegraph holds **no LLM key** of its own — see
[How it works](/how-it-works) for why the agent is the moat.

## Install & download

codegraph is pre-1.0, so today you install it from source. It is one small build:

```bash
git clone https://github.com/sbeeredd04/codegraph
cd codegraph
npm install
npm run build     # compiles the CLI, the MCP server, and the web board
npm link          # puts the `codegraph` command on your PATH
```

`npm link` makes `codegraph` available in any directory. Prefer not to link? Every
command below also works as `node dist/cli.js …` from inside the cloned folder.

**One-line installers are on the way.** Once codegraph is published you will be able
to skip the build entirely:

```bash
npx codegraph            # via npm — no clone, no build
pip install codegraph    # via PyPI — a thin wrapper around the same CLI
```

and install the VS Code extension from the Marketplace. Until those land, use the
from-source build above — it is the same code, just built locally.

## Three ways to use it

One graph, three ways in — a terminal, your editor, or your agent. They share the
same core, so a graph you build in one is the graph the others read.

### 1. CLI + web board

Run one command inside any repository. codegraph indexes the working directory,
builds the graph, and opens the interactive board in your browser.

```bash
cd ~/your-project
codegraph                            # index this repo and open the board
codegraph graph                      # write a durable .codegraph/ artifact (graph.json + a report)
codegraph query "what calls login"   # a grounded answer straight from the saved graph
codegraph serve --from-artifact      # re-open a saved graph without re-scanning
```

The board serves on `http://127.0.0.1:4319` by default (set `CODEGRAPH_PORT` to
change it). It binds to localhost only — your graph is never exposed on the network.

### 2. VS Code extension

Open the folder you want to map, then run a command from the Command Palette
(`Cmd/Ctrl + Shift + P`) — every codegraph command is prefixed **codegraph:**:

- **codegraph: Open Workspace Graph** — build the graph for the whole workspace and
  watch it for changes.
- **codegraph: Open Graph Panel (active file)** — graph just the file you have open.
- **codegraph: Open Unified Explorer (preview)** — the full board inside the editor,
  the surface going forward.
- **codegraph: Index Repository (live progress on the board)** — re-index and watch
  the progress live.
- **codegraph: Refresh & Diff (show what changed)** — re-scan and highlight what
  moved since the last build.

Every node deep-links to its exact file and line, so you can jump from the map
straight into your editor. It stays **read-only**: codegraph reads your code, it
never writes to it.

### 3. Connect your AI agent (the moat)

codegraph holds no LLM key. Instead it exposes the graph to *your* agent (Claude
Code, Codex, or any MCP client) over a standalone MCP server, so the agent queries
structure, impact, and dependencies — and writes its understanding back onto the
board.

- **From the extension:** run **codegraph: Copy MCP Config (connect your AI agent)**
  and paste the result into your agent's MCP settings.
- **Standalone:** point your MCP client at the server directly.

  ```bash
  node dist/mcp-server.js /path/to/repo
  ```

- **Teach your agent to reach for the graph:** install the codegraph agent skill so
  the agent queries the graph before it greps.

  ```bash
  codegraph skill --install   # writes the skill to ~/.claude/skills/codegraph/
  ```

  Run `codegraph skill` with no flag to print it and place it yourself.

Once connected, the agent can call the query tools (`find_nodes`, `dependencies`,
`blast_radius`, `find_path`, `query`, …) and the write tools (`annotate_node`,
`ground_nodes`, `save_diagram`, `save_doc`, `mark_node`, …). Whatever it writes is
cached and rendered on the board.

## Read the map

Once the graph paints, each node is a module, class, function, or method, and each
edge is a call, dependency, or containment relationship. From here you can:

- Click a node to lift it and its neighbours out of the hairball.
- Switch **projection** — Full, Dependency, Structure, or Call — to see one kind of
  relationship at a time.
- Toggle **Folders** to gather same-folder nodes into labelled territories.
- Open the **Orphans** overlay to review nodes with no inbound references.

See [How to use it](/how-to-use) for the full tour of the surface.

## Let the agent onboard the repo

Ask your connected agent to run `codegraph_onboard`. It returns a six-step done/todo
playbook — index the repo, draft an architecture diagram, write an overview doc,
flag hotspots — and walks the repo from empty to a first set of diagrams, docs, and
notes. The matching **Setup** panel on the board mirrors the same checklist for you.

## Next steps

- [How it works](/how-it-works) — the architecture, the two planes, and why there is
  no LLM key in the app.
- [How to use it](/how-to-use) — every affordance on the board, in 2D and 3D.
</content>
</invoke>
