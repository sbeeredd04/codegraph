# codegraph agent skill

`SKILL.md` teaches a connected coding agent (Claude Code, Codex, or any
SKILL.md-aware host) to reach for the **codegraph graph before it greps**. When a
question is about the codebase's structure — what calls X, what X depends on, where
Y lives, how data flows from A to B, the blast radius of changing Z — an accurate
call/import/render graph beats text search, so the skill routes those questions to
the graph and keeps grep for literal string hunts.

It is the same move graphify makes, pointed at codegraph's richer surface: real
`calls` / `depends-on` / JSX `render` edges across TypeScript/JS/TSX and Python,
with signatures, Python decorators, and docstrings — plus an MCP that drives an
interactive board and an editor the human can actually open.

## What it tells the agent to do

1. **Fast path** — before grepping, check for a connected `codegraph` MCP or a
   `.codegraph/graph.json` artifact and answer from it.
2. **Setup** — if neither exists, build the artifact with `npx codegraph graph .`
   (no API key, no account, source never leaves the machine) or connect the MCP.
3. **Grounding** — answer only from the graph, cite `file:line`, never invent an
   edge, and leave durable findings back on the graph (`annotate_node`,
   `save_diagram`) so the next session inherits them.

## Install it

`SKILL.md` lives in this repo as the source of truth. Drop it where your agent
looks for skills — for Claude Code, that's `~/.claude/skills/codegraph/SKILL.md`.

The `codegraph` CLI can do it for you:

```bash
npx codegraph skill              # print SKILL.md to stdout (pipe it anywhere)
npx codegraph skill --install    # write it to ~/.claude/skills/codegraph/SKILL.md
```

`--install` writes under your home directory, so run it yourself when you want it
there — printing is the default so nothing touches `~/.claude` without your say-so.

## Keep it in sync

`SKILL.md` is generated from `src/core/skill/agent-skill.ts` (the pure
`buildAgentSkill()` builder). Do not hand-edit it — change the builder and
regenerate:

```bash
npx tsx -e "import{buildAgentSkill}from'./src/core/skill/agent-skill.ts';import{writeFileSync}from'node:fs';writeFileSync('agent-skill/SKILL.md',buildAgentSkill())"
```

A unit test (`src/core/skill/agent-skill.test.ts`) fails if the committed file
drifts from the builder, so CI catches a stale copy.
