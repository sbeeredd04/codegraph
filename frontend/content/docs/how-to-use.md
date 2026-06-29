---
title: How to use it
order: 3
summary: A tour of every affordance on the board — projections, focus, overlays, knowledge drawers, the Ask panel, and the agent co-pilot.
---

# How to use it

This is the working tour of the explorer. Everything here is read-only — explore
freely.

## Reading a large graph

- **Focus a node.** Click any node to lift it and its first-degree neighbours and
  dim the rest. The lens repaints without relaying out the graph, so positions
  stay stable.
- **Projections.** The segmented control switches between Full, Dependency,
  Structure, and Call — one kind of relationship at a time.
- **Folders.** Toggle Folders to gather same-folder nodes into spatial pockets with
  convex-hull territory outlines and folder labels. Sort the territories by path or
  by size. (2D surface.)
- **2D / 3D.** Switch between the flat force-directed board and a 3D layout. The
  capability card, projections, and knowledge read identically across both;
  outline-based lenses (orphans, trace, folders) stay on the 2D surface.

## Change awareness

- A **live watch loop** re-scans in the background as files change and repaints
  only on a real change.
- The **change-diff overlay** recolors what was added, changed, or moved, with a
  delta badge.
- **Diff against any git ref** (HEAD, a branch, a tag) to see what changed since.
- The **ranked change feed** scores each change by blast radius (reverse
  reachability) — click a row to fly the camera to the node.

## Dead-code awareness

Open the **Orphans** overlay to dim everything except nodes with no inbound
references — dead-code candidates. The wording stays honest: an orphan can also be
a legitimate entry point.

## Knowledge on the board

Your connected agent writes knowledge that renders right on the map:

- **Diagrams.** Mermaid diagrams (architecture, workflow, sequence, dataflow)
  appear in a drawer grouped by category, with "related node" chips that jump back
  into the graph. They render with `securityLevel: "strict"` — agent-authored
  content is untrusted.
- **Docs.** Markdown docs render alongside, sanitized against a strict allowlist;
  `codegraph://node/<address>` links cross-highlight the graph instead of
  navigating away.

## Ask your own agent

The **Ask** panel turns your question plus the selected node's context into a
ready-to-run prompt for your connected agent — grounded in the real graph via the
MCP query tools, and told to capture findings as a diagram or a doc. codegraph
builds the prompt; it holds no LLM key and makes no model call.

## The agent as co-pilot

With the board open, the agent can drive it while you keep the wheel:

- **Overlays** — notes, marks (bug, breakpoint, issue, todo, hotspot), and groups
  the agent pins onto nodes and edges.
- **Live driving** — highlight nodes and paths, fly the camera, switch projection,
  open panels, and toggle overlays. A preempt banner always lets you take over.
- **Guided tours and trace replay** — walk an ordered node sequence over time,
  hand-picked or extracted from a stack trace.
- **Onboarding** — a done/todo Setup checklist that walks a fresh repo from
  indexing to a first set of diagrams, docs, and notes.

## Jump to the source

Every node deep-links to its exact file and line. Open it natively inside the
editor, or follow a `vscode://file` link from the standalone web view. Paths stay
relative and host-local — no source bytes or absolute host paths ever leave the
host.

## The dashboard

Docks are collapsible and resizable, and the knowledge drawers float as inset
panels with the graph visible behind. The layout persists per browser — it is
never written to the snapshot.

## Export and share

Export a portable, versioned JSON snapshot of the graph — nodes, edges, and the
agent's knowledge (annotations, diagrams, docs, and overlays). Open it in the
standalone web viewer with no editor and no server, straight from a file.

## Next steps

- [How it works](/how-it-works) — the architecture behind these affordances.
- [Getting started](/getting-started) — install and connect your agent.
