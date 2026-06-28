// AI-assist prompt builder (Epic 7 / FR-30). codegraph never calls an LLM itself
// — the user's OWN connected agent (Claude Code, Codex, or any MCP client wired to
// the codegraph server) does the synthesis. That is the moat: no API key in the
// IDE, and the source never leaves the host (AD-14 / AD-16). This module turns a
// question plus the user's current graph context into a ready-to-run prompt the
// user pastes into their agent, instructing it to ground the answer in the real
// graph via the codegraph MCP query tools and to capture what it learns as a
// diagram (save_diagram) that then renders on the board (FR-28) — closing the loop
// from "ask" to a durable, shareable artifact.
//
// Pure: a context object in, a prompt string out. No I/O, no network, no key. The
// output is plain text destined for the clipboard, never HTML — so nothing here is
// escaped; the caller copies it verbatim.

/** The codegraph MCP query tools an agent uses to explore the graph (names match
 * src/adapters/mcp/tools.ts exactly, so the prompt references tools that exist). */
export const ASSIST_QUERY_TOOLS = [
  "find_nodes",
  "describe_node",
  "neighborhood",
  "dependencies",
  "find_path",
  "blast_radius",
  "list_orphans",
  "graph_stats",
  "recent_changes",
] as const;

export interface AskFocus {
  readonly address: string;
  readonly name: string;
  readonly kind: string;
}

export interface AskContext {
  /** The user's question (free text). */
  readonly question: string;
  /** The node the user had selected, if any — anchors the agent's exploration. */
  readonly focus?: AskFocus;
  /** First-degree neighbour addresses of the focus, for orientation. */
  readonly neighbours?: readonly string[];
  /** Repo root / dataset label, for provenance in the prompt. */
  readonly root?: string;
}

// Guard rails: the question is user-typed (trusted) but capped so a runaway paste
// can't produce an absurd prompt; the neighbour list is truncated for readability.
const MAX_QUESTION = 2_000;
const MAX_NEIGHBOURS = 12;

function cleanQuestion(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
}

/** True when there is enough to build a meaningful prompt (a non-empty question). */
export function canBuildAskPrompt(ctx: AskContext): boolean {
  return cleanQuestion(ctx.question).length > 0;
}

/**
 * Build the prompt the user pastes into their connected agent. Always returns a
 * valid prompt; an empty question falls back to a general "map this codebase"
 * ask so the affordance is never a dead end.
 */
export function buildAskPrompt(ctx: AskContext): string {
  const question = cleanQuestion(ctx.question) || "Give me an overview of how this codebase fits together.";
  const lines: string[] = [];

  lines.push("You are connected to a codebase through the codegraph MCP server.");
  lines.push("Answer this question, grounding everything in the actual graph:");
  lines.push("");
  lines.push(`  ${question}`);
  lines.push("");

  if (ctx.root) {
    lines.push(`Repository: ${ctx.root}`);
  }
  if (ctx.focus) {
    lines.push(
      `I'm currently looking at \`${ctx.focus.name}\` (${ctx.focus.kind}) at \`${ctx.focus.address}\` — start there.`,
    );
    const neighbours = (ctx.neighbours ?? []).slice(0, MAX_NEIGHBOURS);
    if (neighbours.length) {
      const more = (ctx.neighbours?.length ?? 0) - neighbours.length;
      const suffix = more > 0 ? `, and ${more} more` : "";
      lines.push(`Its direct neighbours: ${neighbours.map((n) => `\`${n}\``).join(", ")}${suffix}.`);
    }
  }
  lines.push("");

  lines.push("How to answer:");
  lines.push(
    `- Explore with the codegraph query tools: ${ASSIST_QUERY_TOOLS.join(", ")}. ` +
      `${ctx.focus ? "Begin with describe_node on the node above, then expand with neighborhood and dependencies." : "Begin with graph_stats and find_nodes to orient yourself."}`,
  );
  lines.push("- Cite the specific node addresses you relied on, so the answer is verifiable.");
  lines.push(
    "- When you understand the relevant structure, call save_diagram to capture it as a Mermaid " +
      "diagram (architecture / workflow / sequence). Set its `related` to the node addresses it covers " +
      "so it appears on the codegraph board and links back into the graph.",
  );
  lines.push("");
  lines.push("Keep the written answer concise; let the diagram carry the structure.");

  return lines.join("\n");
}
