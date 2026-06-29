// Screen-space label de-collision for the 3D surface (FR-65). The 3D canvas
// projects each to-label node to screen and drops an HTML overlay at its position;
// when neighbours cluster (a hub's focus set, or many marked/traced nodes) those
// boxes stack illegibly. This is the pure placement pass: given the projected
// candidates with a priority, it greedily keeps the important labels and drops (or
// gently nudges) the ones that would overlap an already-placed box. Pure + framework-
// free so it stays unit-reasonable and the component renders only what survives.
//
// Priority is LOWER = more important (placed first, never displaced by a lesser one):
// selected/center < hover < driver-highlight < mark < trace < focus-neighbour. The
// pass is O(k^2) over the (small, capped) candidate set, not over all nodes.

/** A label asking to be drawn at a projected screen position. */
export interface LabelCandidate {
  readonly id: string;
  /** The node's projected screen position (px); the box is offset from here. */
  readonly x: number;
  readonly y: number;
  /** Lower wins. Placed in this order; a higher-priority box is never dropped for a lower one. */
  readonly priority: number;
  /** The label text — its length drives the estimated box width. */
  readonly text: string;
}

/** A label that survived de-collision, with its final (possibly nudged) position. */
export interface PlacedLabel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface LabelLayoutOpts {
  /** Approx px width of one monospace 11px glyph. */
  readonly charWidth: number;
  /** Label box height (≈ line height) in px. */
  readonly lineHeight: number;
  /** Horizontal gap from the node to the box's left edge (matches the render offset). */
  readonly offsetX: number;
  /** Extra px of breathing room required between two boxes. */
  readonly padding: number;
  /** How many vertical nudge steps to try (each direction) before dropping a label. */
  readonly maxNudge: number;
  /** Size of one vertical nudge step, px. */
  readonly nudgeStep: number;
}

export const DEFAULT_LABEL_LAYOUT: LabelLayoutOpts = {
  charWidth: 7, // JetBrains Mono / system mono at 11px (~6.6px), rounded up for margin
  lineHeight: 13,
  offsetX: 10,
  padding: 2,
  maxNudge: 2,
  nudgeStep: 13,
};

// FR-65 label-density: a user-chosen bias for how aggressively labels declutter,
// surfaced in Settings. "balanced" reproduces the prior FIXED behaviour exactly
// (3D FOCUS_LABEL_CAP 18 + DEFAULT_LABEL_LAYOUT padding/nudge; 2D Sigma 0.6 / 7), so
// the default is unchanged. "sparse" shows fewer, cleaner labels (lower cap, more
// padding); "dense" surfaces more (higher cap, tighter packing). Defined here — the
// label module — so both surfaces and Settings import it without an import cycle.
export type LabelDensity = "sparse" | "balanced" | "dense";

export interface LabelDensityProfile {
  /** 3D: max focus-neighbour labels shown before suppression (the old FOCUS_LABEL_CAP). */
  readonly focusCap: number;
  /** 3D: de-collision box padding px (smaller → boxes pack tighter → more survive). */
  readonly padding: number;
  /** 3D: vertical nudge attempts each way before a label is dropped. */
  readonly maxNudge: number;
  /** 2D: Sigma `labelDensity`. */
  readonly sigmaDensity: number;
  /** 2D: Sigma `labelRenderedSizeThreshold` (lower → more nodes get a standing label). */
  readonly sigmaThreshold: number;
}

export const LABEL_DENSITY_PROFILES: Record<LabelDensity, LabelDensityProfile> = {
  sparse: { focusCap: 8, padding: 6, maxNudge: 1, sigmaDensity: 0.35, sigmaThreshold: 11 },
  balanced: { focusCap: 18, padding: 2, maxNudge: 2, sigmaDensity: 0.6, sigmaThreshold: 7 },
  dense: { focusCap: 48, padding: 0, maxNudge: 4, sigmaDensity: 1, sigmaThreshold: 3 },
};

/** Resolve a density preset (defaults to "balanced" when unset). */
export function labelDensityProfile(density: LabelDensity | undefined): LabelDensityProfile {
  return LABEL_DENSITY_PROFILES[density ?? "balanced"];
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxAt(c: LabelCandidate, y: number, o: LabelLayoutOpts): Rect {
  const left = c.x + o.offsetX;
  const halfH = o.lineHeight / 2;
  return {
    left,
    right: left + c.text.length * o.charWidth,
    top: y - halfH,
    bottom: y + halfH,
  };
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.left - pad < b.right &&
    a.right + pad > b.left &&
    a.top - pad < b.bottom &&
    a.bottom + pad > b.top
  );
}

/** Vertical offsets to try, in order: none, then alternating up/down by step. */
function nudgeOffsets(o: LabelLayoutOpts): number[] {
  const offs = [0];
  for (let k = 1; k <= o.maxNudge; k++) offs.push(-k * o.nudgeStep, k * o.nudgeStep);
  return offs;
}

/**
 * Greedy de-collision: sort by priority, place each label at the first vertical
 * offset whose box clears every already-placed box, else drop it. Returns the kept
 * labels with their final positions, ready to render. Stable for equal priorities
 * (keeps input order), so the result is deterministic.
 */
export function layoutLabels3D(
  candidates: readonly LabelCandidate[],
  opts: LabelLayoutOpts = DEFAULT_LABEL_LAYOUT,
): PlacedLabel[] {
  const ordered = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority || a.i - b.i);
  const placed: Rect[] = [];
  const out: PlacedLabel[] = [];
  const offsets = nudgeOffsets(opts);
  for (const { c } of ordered) {
    for (const dy of offsets) {
      const rect = boxAt(c, c.y + dy, opts);
      if (placed.every((p) => !overlaps(rect, p, opts.padding))) {
        placed.push(rect);
        out.push({ id: c.id, x: c.x, y: c.y + dy, text: c.text });
        break;
      }
    }
  }
  return out;
}
