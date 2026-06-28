import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodeGraph } from "../../core/graph/graph.js";
import { graphTools, type GraphToolDeps } from "./tools.js";

// SDK glue (AD-2): register the graph tools on an McpServer. The graph is read
// through an accessor so the server always serves the latest snapshot. The
// optional capabilities ride a single {@link GraphToolDeps} bag: `recentChanges`
// for the live "what just changed" feed, `annotations` for annotate_node,
// `diagrams`/`docs`/`overlays` for the knowledge write tools (and, when all three
// are present, the `codegraph_onboard` bootstrap playbook — FR-42), and
// `commands` for the live FR-39 driving tools.
export function createGraphMcpServer(getGraph: () => CodeGraph, deps: GraphToolDeps = {}): McpServer {
  const server = new McpServer({ name: "codegraph", version: "0.0.1" });
  for (const tool of graphTools(getGraph, deps)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      // eslint-disable-next-line @typescript-eslint/require-await
      async (args: Record<string, unknown>) => tool.handler(args),
    );
  }
  return server;
}
