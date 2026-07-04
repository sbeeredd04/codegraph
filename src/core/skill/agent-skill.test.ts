import { describe, it, expect } from "vitest";
import { buildAgentSkill, AGENT_SKILL_NAME, AGENT_SKILL_DESCRIPTION, CODEGRAPH_QUERY_TOOLS } from "./agent-skill.js";

// The MCP tool names the skill is allowed to cite — kept in lockstep with the real
// surface in src/adapters/mcp/tools.ts. If a tool is renamed there, this list (and
// the skill) must follow, so the skill never points an agent at a tool that doesn't exist.
const REAL_MCP_TOOLS = new Set([
  "query",
  "find_nodes", "find_symbol", "find_file", "list_packages", "entry_points",
  "describe_node", "blast_radius", "dependencies", "find_path", "neighborhood",
  "list_orphans", "graph_stats", "recent_changes", "annotate_node", "save_diagram",
  "list_diagrams", "delete_diagram", "save_doc", "list_docs", "delete_doc",
  "codegraph_onboard", "highlight_nodes", "highlight_path", "focus_camera",
  "set_projection", "open_panel", "toggle_affordance", "reveal_in_editor",
  "guided_tour", "replay_trace",
]);

describe("buildAgentSkill (FR-92)", () => {
  const md = buildAgentSkill();

  it("opens with valid skill frontmatter (name + description)", () => {
    expect(md.startsWith(`---\nname: ${AGENT_SKILL_NAME}\n`)).toBe(true);
    expect(md).toContain(AGENT_SKILL_DESCRIPTION);
  });

  it("leads with the fast-path: check for a graph before grepping", () => {
    expect(md).toMatch(/Fast path/i);
    expect(md).toMatch(/before any grep/i);
    expect(md).toContain(".codegraph/graph.json");
  });

  it("only cites MCP tools that actually exist", () => {
    for (const tool of CODEGRAPH_QUERY_TOOLS) {
      expect(REAL_MCP_TOOLS.has(tool)).toBe(true);
      expect(md).toContain(tool); // and every cited tool appears in the body
    }
  });

  it("documents setup (npx codegraph graph) and the artifact shape", () => {
    expect(md).toContain("npx codegraph graph .");
    expect(md).toMatch(/nodes\[\]/);
    expect(md).toMatch(/calls\|depends-on\|contains/);
  });

  it("states the grounding rules (cite file:line, never invent an edge)", () => {
    expect(md).toMatch(/file:line/);
    expect(md).toMatch(/never invent an edge/i);
  });

  it("is deterministic", () => {
    expect(buildAgentSkill()).toBe(md);
  });
});
