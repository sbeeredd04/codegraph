import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodeGraph } from "../../core/graph/graph.js";
import { graphTools } from "./tools.js";

// SDK glue (AD-2): register the graph tools on an McpServer. The graph is read
// through an accessor so the server always serves the latest snapshot.
export function createGraphMcpServer(getGraph: () => CodeGraph): McpServer {
  const server = new McpServer({ name: "codegraph", version: "0.0.1" });
  for (const tool of graphTools(getGraph)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      // eslint-disable-next-line @typescript-eslint/require-await
      async (args: Record<string, unknown>) => tool.handler(args),
    );
  }
  return server;
}
