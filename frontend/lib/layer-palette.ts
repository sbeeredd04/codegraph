// Visual palette for layered neighbour analysis (FR-72). The pure core
// (`@core/graph/layers` layeredNeighbourhood) gives each node its BFS depth from
// the selected node; COLOUR is the renderer's concern, so the depth→hue mapping
// lives here — shared by the 2D Sigma surface and (FR-72b-2) the 3D draw loop, so
// both paint identical concentric shells.
//
// A same-hue lightness ramp (the old violet→indigo trail) made every shell read as
// "a similar purple" — adjacent depths blurred together. Per the OKLCH lesson
// (equal lightness steps look equally different only when the hue also moves), the
// ramp now ROTATES HUE across a perceptually-even cool sweep — violet → indigo →
// blue → sky → cyan → teal → emerald — so each concentric shell is unmistakably its
// own colour, and none of them collapse into the off-lens dim (#39414f). It reads
// like a sequential heat-ramp ("distance from focus"), which is also colour-blind
// friendlier than a monochrome purple gradient. Depth 0 keeps the brand selection
// violet for continuity with the selection lens; past the ramp the emerald floor
// repeats. (Kind colours are replaced by these in Layers mode, so the cool sweep
// never competes with a node's own hue.)

// Depth 0 = the selected node (matches the 2D SELECTED_NODE / 3D SELECTED #c4b5fd).
// Depth 1 stays violet-400 (also reused as the driver-highlight accent elsewhere).
const LAYER_HUES = [
  "#c4b5fd", // depth 0 — violet-300, brightest (the focus)
  "#a78bfa", // depth 1 — violet-400
  "#818cf8", // depth 2 — indigo-400
  "#60a5fa", // depth 3 — blue-400
  "#38bdf8", // depth 4 — sky-400
  "#22d3ee", // depth 5 — cyan-400
  "#2dd4bf", // depth 6 — teal-400
  "#34d399", // depth 7+ — emerald-400 (floor): clearly distinct, well above the dim
] as const;

/** The hue for a node at BFS `depth` from the selected node (FR-72). Depth 0 is the
 * focus violet; each outer shell steps to the next distinct hue on the cool sweep;
 * clamped to the emerald floor past the ramp. A negative / non-finite depth guards
 * to 0 (the centre hue). */
export function layerColor(depth: number): string {
  const d = Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0;
  return LAYER_HUES[Math.min(d, LAYER_HUES.length - 1)];
}

/** The full ramp, for rendering the depth-control legend so its swatches match
 * exactly what the canvas paints. Index = depth (last entry is the repeating floor). */
export const LAYER_RAMP: readonly string[] = LAYER_HUES;
