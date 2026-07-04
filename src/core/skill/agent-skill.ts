// FR-92 — the codegraph agent skill. Graphify's real leverage is a SKILL.md that
// makes the connected agent reach for the GRAPH before it greps: check for a built
// graph, and if the question is about structure, answer from the graph instead of
// scanning files. This builds that same skill for codegraph — pointed at the FR-91
// `.codegraph/` artifact and the codegraph MCP (the accurate, multi-language graph),
// with codegraph's edge: real call/import/JSX-render edges, signatures, decorators,
// docstrings, and an interactive board a human can open.
//
// Pure (AD-1): a string in memory, no I/O. The CLI prints or installs it; the
// committed `agent-skill/SKILL.md` is generated from this same source of truth.

export const AGENT_SKILL_NAME = "codegraph";

export const AGENT_SKILL_DESCRIPTION =
  "Use for any question about THIS repository's structure, call graph, dependencies, " +
  "entry points, or where code lives ('what calls X', 'what does X depend on', " +
  "'where is Y defined', 'how does data flow from A to B', 'impact of changing Z'). " +
  "Before grepping, check for a codegraph graph (a .codegraph/graph.json artifact or a " +
  "connected codegraph MCP) and answer from it — it is an accurate multi-language " +
  "(TypeScript/JS/TSX/Python) knowledge graph with real call/import/render edges, " +
  "signatures, and decorators, so it beats text search for structural questions.";

/** The read/traversal codegraph MCP tools the skill leans on (a subset of the full
 *  tool surface — the drive-the-board + authoring tools are documented in the body). */
export const CODEGRAPH_QUERY_TOOLS = [
  "query",
  "find_symbol",
  "find_file",
  "find_nodes",
  "entry_points",
  "list_packages",
  "describe_node",
  "dependencies",
  "blast_radius",
  "find_path",
  "neighborhood",
  "list_orphans",
  "graph_stats",
  "recent_changes",
  "reveal_in_editor",
] as const;

/** Build the full SKILL.md (frontmatter + body). Deterministic — same string every
 *  call — so the CLI and the committed file never drift. */
export function buildAgentSkill(): string {
  return `---
name: ${AGENT_SKILL_NAME}
description: "${AGENT_SKILL_DESCRIPTION}"
---

# codegraph — query the graph, don't grep

codegraph turns this repo into an accurate, multi-language knowledge graph:
tree-sitter skeletons plus ts-morph / Pyright resolve REAL edges — \`calls\`,
\`depends-on\` (imports), and JSX \`renders\` — with function signatures, Python
decorators/routes, and docstrings. For any question about how the codebase fits
together, the graph is faster and more correct than text search.

## Step 0 — Fast path (do this FIRST, before any grep)

Check whether a graph already exists:

1. **A connected codegraph MCP?** If the \`codegraph\` MCP server is available, its
   tools ARE the graph — use them (see "Query with the MCP" below). Prefer this.
2. **A \`.codegraph/graph.json\` artifact?** Check the repo root. If it exists, read
   \`.codegraph/GRAPH_REPORT.md\` for a fast overview, then query \`graph.json\`
   directly (see "Query the artifact").

If a graph exists **and** the request is a structural question about the codebase,
answer from the graph — do NOT grep the tree. Grep only for literal string/regex
hunts (a specific error message, a TODO), never for "what calls X" / "where is Y".

If NO graph exists, build one (see "Setup"), then continue.

## When the graph wins over grep

| The question | Use |
|---|---|
| Any NL question about the code, in one call | \`query\` (start here) |
| Where is \`login\` / the auth module? | \`find_symbol\` / \`find_file\` |
| What calls X? Who depends on X? | \`dependencies\` (direction: dependents) / \`blast_radius\` |
| What does X call / import? | \`dependencies\` (direction: dependencies) |
| How does data get from A to B? | \`find_path\` |
| What's directly around X? | \`neighborhood\` |
| Where does execution start? | \`entry_points\` |
| Blast radius of changing X? | \`blast_radius\` |
| Overview / packages / counts? | \`graph_stats\` / \`list_packages\` |
| Full detail of one symbol (signature, edges, file:line) | \`describe_node\` |
| Show the human the actual code | \`reveal_in_editor\` (opens their editor) |

## Query with the MCP (preferred)

Read/traversal tools: ${CODEGRAPH_QUERY_TOOLS.join(", ")}.

**\`query\` is the one-shot entry** — ask it a natural-language question
(\`query({question: "what calls login"})\`) and it returns the matching nodes with
their real call/depends-on/contains edges, their callers, and file:line citations,
grounded in the graph. Reach for it first; drop to the specific tools below to drill
in. (Without the MCP, the same answer comes from \`codegraph query "<q>"\` on the
\`.codegraph/graph.json\` artifact.)

Node addresses are stable: \`ts:src/auth.ts#login\`, \`py:app/api.py#Config.load\`.
Start from \`find_symbol\`/\`find_file\` to resolve an address, then \`describe_node\`
for its signature + neighbours, or \`find_path\`/\`dependencies\`/\`blast_radius\` to
trace relationships. \`reveal_in_editor\` points the human at the real file:line.

The MCP also drives the interactive board for the human (\`highlight_nodes\`,
\`highlight_path\`, \`focus_camera\`, \`set_projection\`, \`open_panel\`, \`guided_tour\`,
\`replay_trace\`) and lets you author durable knowledge onto the graph
(\`annotate_node\`, \`save_diagram\`, \`save_doc\`) — use these to leave the human a
map of what you found, not just an answer.

## Query the artifact (no MCP)

\`.codegraph/graph.json\` is a plain snapshot: \`{ version, root?, nodeCount,
edgeCount, nodes[], edges[], enrichments?, diagrams?, docs? }\`.
- **node**: \`{ address, kind (module|class|function|method), name, location: {file, line, character}, signature?, doc?, decorators? }\`
- **edge**: \`{ from, to, type (calls|depends-on|contains), call? (e.g. "render" for JSX) }\`

Resolve a name to a node, then walk \`edges\` by \`from\`/\`to\` to trace callers,
callees, imports, and renders. Cite \`location.file\`:\`location.line\` for every claim.

## Setup (only if no graph exists)

Build the artifact — no API key, no account, source never leaves the machine:

\`\`\`bash
npx codegraph graph .      # writes .codegraph/graph.json + GRAPH_REPORT.md
\`\`\`

Open the interactive board for the human (2D/3D, projections, diff, trace):

\`\`\`bash
npx codegraph .            # scans + opens the board in the browser
\`\`\`

Or connect the MCP so your tools query the live graph (the codegraph VS Code
extension's "Copy MCP Config" command emits the exact snippet):

\`\`\`json
{ "mcpServers": { "codegraph": { "command": "node", "args": ["<path>/dist/mcp-server.js", "<repoRoot>"] } } }
\`\`\`

## Grounding rules

- Answer **only** from the graph. If it doesn't contain the relationship, say so —
  never invent an edge or a caller.
- Cite \`file:line\` (from a node's \`location\`) for every specific claim.
- Send the human to code with \`reveal_in_editor\`, and leave durable findings via
  \`annotate_node\` / \`save_diagram\` so the next session (human or agent) inherits them.
`;
}
