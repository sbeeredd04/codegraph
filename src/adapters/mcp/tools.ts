import type { CodeGraph } from "../../core/graph/graph.js";
import type { NodeAnnotations } from "../../core/semantic/annotations.js";
import type { DiagramStore } from "../../core/diagrams/diagram.js";
import type { DocStore } from "../../core/docs/doc.js";
import type { OverlayStore } from "../../core/overlays/overlay.js";
import type { PresentationCommandSink } from "../../core/presentation/command.js";
import { type GraphTool, type RecentChangesProvider } from "./mcp-tool.js";
import { readTools } from "./read-tools.js";
import {
  recentChangesTool,
  annotateTool,
  diagramWriteTools,
  docWriteTools,
  onboardTool,
} from "./knowledge-tools.js";
import { overlayWriteTools } from "./overlay-tools.js";
import { driveTools } from "./drive-tools.js";

// MCP tool surface (Epic 3 / FR-13): the questions the user's AI agent asks of the live
// graph — the same map the human reads. This module is the thin ASSEMBLER: it composes
// the tool-group modules (read-tools, knowledge-tools, overlay-tools, drive-tools) into
// the final set, gating each write/drive group on the capability the host wired. Every
// group lives in its own file so it's small and independently testable; graphTools just
// decides which are present.

// The tool-result shape + descriptor + cross-module data types live in ./mcp-tool;
// re-exported here so existing importers of these from ./tools keep working.
export type { McpToolResult, GraphTool, RecentChanges, RecentChangesProvider } from "./mcp-tool.js";

/**
 * Optional capabilities injected into {@link graphTools}. Every field gates a group of
 * write/drive tools that only appear when the host wires the backing store: `recentChanges`
 * → the live change feed, `annotations` → annotate_node (and describe_node's enrichment
 * fold), `diagrams`/`docs`/`overlays` → the knowledge write tools (and, when all three are
 * present, codegraph_onboard), `commands` → the FR-39 driving tools. Passed as one bag so
 * adding a capability never reorders existing call sites.
 */
export interface GraphToolDeps {
  readonly recentChanges?: RecentChangesProvider;
  readonly annotations?: NodeAnnotations;
  readonly diagrams?: DiagramStore;
  readonly docs?: DocStore;
  readonly overlays?: OverlayStore;
  readonly commands?: PresentationCommandSink;
}

/**
 * Build the graph tools bound to a graph accessor (re-read each call so live updates
 * show). The always-on read/query tools are always present; the optional write/drive
 * groups appear only when their backing capability is supplied in {@link GraphToolDeps}.
 */
export function graphTools(getGraph: () => CodeGraph, deps: GraphToolDeps = {}): GraphTool[] {
  const { recentChanges, annotations, diagrams, docs, overlays, commands } = deps;

  const tools: GraphTool[] = [...readTools(getGraph, annotations)];

  if (recentChanges) tools.push(recentChangesTool(recentChanges));
  if (annotations) tools.push(annotateTool(annotations));
  if (diagrams) tools.push(...diagramWriteTools(diagrams));
  if (docs) tools.push(...docWriteTools(docs));
  if (overlays) tools.push(...overlayWriteTools(getGraph, overlays));
  if (diagrams && docs && overlays) tools.push(onboardTool(getGraph, { diagrams, docs, overlays }));
  if (commands) tools.push(...driveTools(getGraph, commands));

  return tools;
}
