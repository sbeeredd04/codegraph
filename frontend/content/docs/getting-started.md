---
title: Getting started
order: 1
summary: Install the extension, build the graph for a repository, and connect your own AI agent over MCP.
---

# Getting started

codegraph maps a codebase into a live, navigable graph beside your editor — and
exposes that same graph to the AI agent you already use. This guide takes you
from a fresh install to a working map with your agent connected.

## 1. Open a repository

codegraph ships as a VS Code extension and as a web explorer built from the same
codebase. In the editor, open the folder you want to map, then run a command from
the Command Palette (`Cmd/Ctrl + Shift + P`):

- **codegraph: Open Workspace Graph** — build the graph for the whole workspace
  and start watching for changes.
- **codegraph: Open Graph Panel (active file)** — graph just the file you have open.
- **codegraph: Open Unified Explorer (preview)** — open the Next.js explorer, the
  surface going forward, inside the editor.

The first build parses every supported source file and lays out the graph. It is
**read-only**: codegraph reads your code, it never writes to it.

## 2. Read the map

Once the graph paints, each node is a module, class, function, or method, and each
edge is a call, dependency, or containment relationship. From here you can:

- Click a node to lift it and its neighbours out of the hairball.
- Switch **projection** — Full, Dependency, Structure, or Call — to see one kind
  of relationship at a time.
- Toggle **Folders** to gather same-folder nodes into labelled territories.
- Open the **Orphans** overlay to review nodes with no inbound references.

See [How to use it](/how-to-use) for the full tour of the surface.

## 3. Connect your AI agent (the moat)

codegraph holds **no LLM key**. Instead it exposes the graph to *your* agent
(Claude Code, Codex, or any MCP client) over a standalone MCP server, so the agent
can query structure, impact, and dependencies — and write its understanding back
onto the board.

1. Run **codegraph: Copy MCP Config (connect your AI agent)** and paste the result
   into your agent's MCP settings. It points the client at the per-workspace MCP
   server.
2. Your agent can now call the query tools (`find_nodes`, `dependencies`,
   `blast_radius`, `find_path`, …) and the write tools (`annotate_node`,
   `save_diagram`, `save_doc`, `mark_node`, …). Whatever it writes is cached and
   rendered on the board.

You can also run the server directly against any repo:

```bash
node dist/mcp-server.js /path/to/repo
```

## 4. Let the agent onboard the repo

Ask your connected agent to run `codegraph_onboard`. It returns a six-step
done/todo playbook — index the repo, draft an architecture diagram, write an
overview doc, flag hotspots — and walks the repo from empty to a first set of
diagrams, docs, and notes. The matching **Setup** panel on the board mirrors the
same checklist for you.

## Next steps

- [How it works](/how-it-works) — the architecture, the two planes, and why
  there is no LLM key in the app.
- [How to use it](/how-to-use) — every affordance on the board, in 2D and 3D.
