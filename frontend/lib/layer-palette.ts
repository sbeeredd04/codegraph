// Visual palette for layered neighbour analysis (FR-72). The pure core
// (`@core/graph/layers` layeredNeighbourhood) gives each node its BFS depth from
// the selected node; COLOUR is the renderer's concern, so the depth→hue mapping
// lives here — shared by the 2D Sigma surface and (FR-72b-2) the 3D draw loop, so
// both paint identical concentric shells. The selected node (depth 0) is brightest
// — the same light violet the surfaces already use for a selection — and each
// outer layer steps DOWN in lightness along the brand violet→indigo family, so
// distance-from-focus reads as a fading gradient. Past the ramp the floor hue
// repeats: a deep neighbourhood stays legible without an ever-darkening trail that
// would blur into the off-lens dim (#39414f).

// Depth 0 = the selected node (matches the 2D SELECTED_NODE / 3D SELECTED #c4b5fd).
const LAYER_HUES = [
  "#c4b5fd", // depth 0 — violet-300, brightest (the focus)
  "#a78bfa", // depth 1 — violet-400
  "#8f86e6", // depth 2
  "#7a72cf", // depth 3
  "#655fb0", // depth 4
  "#524d8a", // depth 5+ — floor: still clearly violet, brighter than the off-lens dim
] as const;

/** The brand hue for a node at BFS `depth` from the selected node (FR-72). Depth 0
 * is brightest; each layer dims with depth; clamped to the floor hue past the ramp.
 * A negative / non-finite depth guards to 0 (the centre hue). */
export function layerColor(depth: number): string {
  const d = Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0;
  return LAYER_HUES[Math.min(d, LAYER_HUES.length - 1)];
}

/** The full ramp, for rendering the depth-control legend so its swatches match
 * exactly what the canvas paints. Index = depth (last entry is the repeating floor). */
export const LAYER_RAMP: readonly string[] = LAYER_HUES;
