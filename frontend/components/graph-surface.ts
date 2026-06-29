// The shared contract for a graph render surface (FR-17 / AD-15). Both the 2D
// Sigma canvas and the 3D canvas accept exactly these props, so the Explorer can
// swap render adapters without touching its call-site — same projected graph,
// same interaction callbacks, only the rendering substrate differs.

import type { ProjectionKind } from "@core/graph/projection";
import type { GraphNode, GraphEdge } from "@core/graph/types";
import type { FolderSort } from "@adapters/surfaces/webview/folder-layout";
import type { SurfaceController } from "@/lib/surface-controller";

export type RenderMode = "2d" | "3d";

export interface GraphSurfaceProps {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly projection: ProjectionKind;
  /** The selected node's address (or null) — drives the neighbour-focus lens
   * (FR-25): the surface lifts this node + its first-degree neighbours out of the
   * hairball and recedes the rest. */
  readonly selected: string | null;
  /** Gather nodes into per-folder regions (FR-26). 2D surface only for now. */
  readonly folderClustered: boolean;
  /** How folder regions are ordered onto the cluster anchors (FR-26 follow-up):
   * `"path"` alphabetical or `"size"` (largest central). 2D surface only. */
  readonly folderSort: FolderSort;
  /** Dim everything except dead-code candidates (FR-12). 2D surface only for now. */
  readonly orphanMode: boolean;
  /** When true, a click extends the manual execution trace (FR-61) instead of
   * selecting — forwarding to `onTraceClick`. Honoured by both 2D and 3D. */
  readonly traceArmed: boolean;
  /** The current manual trace (FR-61): the ordered node sequence the Explorer
   * owns. The surface paints it as a trail — every step node leads and the
   * directed edges between consecutive hops light up. Declarative, so it survives
   * a projection/surface rebuild. Honoured by both 2D and 3D. */
  readonly traceSteps: readonly string[];
  /** Hover: the node the pointer is over (its address), or null on leave. */
  readonly onHoverNode: (address: string | null) => void;
  /** A node was clicked (while not tracing) — select it for the detail panel. */
  readonly onSelectNode: (address: string) => void;
  /** A node was clicked while the trace tool is armed (FR-61) — extend the manual
   * trace to it. The Explorer owns the pure trace model and repaints the trail via
   * `traceSteps`; the surface only reports the click. Both surfaces. */
  readonly onTraceClick?: (address: string) => void;
  /** Empty-canvas click — clear the current selection (and its focus lens). */
  readonly onClearSelection: () => void;
  /** Orphan count for the current projection, reported up for the toggle UI. */
  readonly onOrphanCount: (count: number) => void;
  /** Imperative controller handle (FR-43) — the parent installs a ref here and
   * the mounted surface populates it with focus/frame/highlight/replay, so the
   * host (and the FR-39 command bus to come) can DRIVE the surface, not just read
   * a selection. Generalises the old single-purpose focusRef; works on both the
   * 2D and 3D surfaces. */
  readonly controllerRef?: React.MutableRefObject<SurfaceController | null>;
  /** The agent's marked nodes (FR-37): address → canvas colour for the node's
   * dominant mark. The surface tints these on the graph itself so the agent can
   * "point" at nodes, not just annotate the detail panel. Honoured by 2D + 3D. */
  readonly markedNodes?: ReadonlyMap<string, string>;
  /** Addresses that belong to any agent group (FR-37) — tinted as an ambient
   * hint when not already marked. Honoured by 2D + 3D. */
  readonly groupedNodes?: ReadonlySet<string>;
}
