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
