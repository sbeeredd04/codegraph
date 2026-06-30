// Canvas colours for the agent's overlay marks (FR-37). The detail panel renders
// marks as Tailwind-classed badges; on the WebGL graph surface a node can only be
// recoloured, so each mark kind maps to a bright hue that pops against the dark
// canvas — keyed to the same hues the detail-panel badges use (bug=red,
// breakpoint=rose, issue=amber, todo=sky, hotspot=orange) so the two surfaces
// read as one system. Shared by the 2D canvas now; the 3D surface adopts it with
// the generalized focus controller (FR-43).
import type { MarkKind } from "@core/overlays/overlay";
import type { HighlightStyle } from "./surface-controller";

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

// Transient driver-highlight colours (FR-43) — the live "look here" a controller
// pulses onto a node set. Brighter/cooler than the ambient mark hues so a driven
// highlight reads ABOVE a persistent mark when both land on the same node.
export const HIGHLIGHT_STYLE_COLOR: Record<HighlightStyle, string> = {
  accent: "#a78bfa", // brand violet — generic "look here"
  trace: "#34d399", // emerald — an execution / call path step
  warn: "#f59e0b", // amber — attention without alarm
  // FR-71 — the connections peek: cyan, deliberately distinct from the violet
  // selection/focus lens (FR-25), emerald trace and amber warn/diff hues, so a
  // ctrl/⌘-click peek of a node + its neighbours never reads as a selection.
  peek: "#22d3ee", // cyan-400 — "what is this wired to"
};
