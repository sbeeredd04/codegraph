// Canvas colours for the agent's overlay marks (FR-37). The detail panel renders
// marks as Tailwind-classed badges; on the WebGL graph surface a node can only be
// recoloured, so each mark kind maps to a bright hue that pops against the dark
// canvas — keyed to the same hues the detail-panel badges use (bug=red,
// breakpoint=rose, issue=amber, todo=sky, hotspot=orange) so the two surfaces
// read as one system. Shared by the 2D canvas now; the 3D surface adopts it with
// the generalized focus controller (FR-43).
import type { MarkKind } from "@core/overlays/overlay";

export const MARK_CANVAS_COLOR: Record<MarkKind, string> = {
  bug: "#f87171", // red-400
  breakpoint: "#fb7185", // rose-400
  issue: "#fbbf24", // amber-400
  todo: "#38bdf8", // sky-400
  hotspot: "#fb923c", // orange-400
};

// A muted teal for "belongs to a named group" — cool and recessive so it reads as
// an ambient hint, never competing with the brighter, intentional mark hues.
export const GROUP_TINT = "#5b8a9a";
