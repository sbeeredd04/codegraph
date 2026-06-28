// The shared contract for a graph render surface (FR-17 / AD-15). Both the 2D
// Sigma canvas and the 3D canvas accept exactly these props, so the Explorer can
// swap render adapters without touching its call-site — same projected graph,
// same interaction callbacks, only the rendering substrate differs.

import type { ProjectionKind } from "@core/graph/projection";
import type { GraphNode, GraphEdge } from "@core/graph/types";

export type RenderMode = "2d" | "3d";

export interface GraphSurfaceProps {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly projection: ProjectionKind;
  /** Dim everything except dead-code candidates (FR-12). 2D surface only for now. */
  readonly orphanMode: boolean;
  /** When true, a click picks the path source then traces to the target. 2D only. */
  readonly traceArmed: boolean;
  /** Hover: the node the pointer is over (its address), or null on leave. */
  readonly onHoverNode: (address: string | null) => void;
  /** A node was clicked (while not tracing) — select it for the detail panel. */
  readonly onSelectNode: (address: string) => void;
  /** Orphan count for the current projection, reported up for the toggle UI. */
  readonly onOrphanCount: (count: number) => void;
  /** Trace progress: status text for the live region, or "" to clear it. 2D only. */
  readonly onTraceStatus: (text: string, tone?: "ok" | "none") => void;
  /** Imperative focus handle — parent calls this to pan/zoom to an address. */
  readonly focusRef?: React.MutableRefObject<((address: string) => void) | null>;
}
