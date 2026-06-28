import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodeGraph } from "../../core/graph/graph.js";
import type { NodeAnnotations } from "../../core/semantic/annotations.js";
import type { DiagramStore } from "../../core/diagrams/diagram.js";
import type { DocStore } from "../../core/docs/doc.js";
import type { OverlayStore } from "../../core/overlays/overlay.js";
import { graphTools, type RecentChangesProvider } from "./tools.js";

// SDK glue (AD-2): register the graph tools on an McpServer. The graph is read
// through an accessor so the server always serves the latest snapshot. Pass
// `recentChanges` to also expose the live "what just changed" feed, `annotations`
// for the agent-driven annotate_node write tool, `diagrams` for the
// save_diagram / list_diagrams / delete_diagram knowledge-diagram tools, `docs`
// for the save_doc / list_docs / delete_doc knowledge-doc tools, and `overlays`
// for the pin_note / annotate_edge / mark_node / group_nodes overlay tools.
export function createGraphMcpServer(
  getGraph: () => CodeGraph,
  recentChanges?: RecentChangesProvider,
  annotations?: NodeAnnotations,
  diagrams?: DiagramStore,
  docs?: DocStore,
  overlays?: OverlayStore,
): McpServer {
  const server = new McpServer({ name: "codegraph", version: "0.0.1" });
  for (const tool of graphTools(getGraph, recentChanges, annotations, diagrams, docs, overlays)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      // eslint-disable-next-line @typescript-eslint/require-await
      async (args: Record<string, unknown>) => tool.handler(args),
    );
  }
  return server;
}
