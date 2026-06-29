// Convex-hull package regions (FR-57b). The colour-by-package tint (FR-57) recedes
// each node into its package's hue; this draws the package's *boundary* — a padded
// convex hull around its members — so a monorepo's subsystems read as enclosed
// territories at a glance, not just same-coloured dots. Pure + framework-free: it
// takes the already-projected screen points (grouped by their package tint colour,
// which doubles as a stable per-package key) and returns one polygon per package,
// ready for the surface to stroke/fill. The surface owns when to recompute (same
// cadence as labels — on camera move / layout change) and the opacity it draws at.
//
// Grouping by the tint COLOUR (not a pkgId) keeps the 3D surface free of the
// partition: nodes sharing a tint are the same package. The palette wraps past 10
// packages, so two packages could share a hue and merge — a harmless edge for a
// recessive wash. Hulls need ≥3 points; 1–2-node packages just rely on the tint.

/** A point in screen space (px). */
export interface RegionPoint {
  readonly x: number;
  readonly y: number;
}

/** A projected node asking to be enclosed, tagged with its package tint colour. */
export interface RegionInput {
  readonly x: number;
  readonly y: number;
  /** The package's tint colour — the group key AND the polygon's draw colour. */
  readonly color: string;
}

/** One package's enclosing region: a padded convex-hull polygon in its hue. */
export interface PackageRegion {
  /** The package tint colour — stroke + fill hue (also the dedupe key). */
  readonly color: string;
  /** The padded hull, ≥3 points, ordered counter-clockwise. */
  readonly polygon: readonly RegionPoint[];
}

/** Default outward padding (px) so the hull clears the node spheres + labels. */
export const DEFAULT_REGION_PAD = 22;

const cross = (o: RegionPoint, a: RegionPoint, b: RegionPoint): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * Andrew's monotone-chain convex hull. Deterministic (sorts by x then y), returns
 * the hull counter-clockwise with collinear points dropped. Fewer than 3 distinct
 * hull vertices (all points collinear/coincident) → empty, so the caller skips it.
 */
function convexHull(points: readonly RegionPoint[]): RegionPoint[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const n = pts.length;
  if (n < 3) return [];
  const lower: RegionPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: RegionPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : [];
}

/** Push each hull vertex outward from the polygon's centroid by `pad` px. */
function padOutward(hull: readonly RegionPoint[], pad: number): RegionPoint[] {
  let cx = 0;
  let cy = 0;
  for (const p of hull) {
    cx += p.x;
    cy += p.y;
  }
  cx /= hull.length;
  cy /= hull.length;
  return hull.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad };
  });
}

/**
 * Build one padded convex-hull region per package (grouped by tint colour) from the
 * projected screen points. Packages with fewer than 3 projected points — or whose
 * points are collinear — are skipped (no meaningful hull). Pure + deterministic:
 * groups in first-seen colour order, each hull O(m log m) over its members.
 */
export function buildPackageRegions(
  points: readonly RegionInput[],
  pad: number = DEFAULT_REGION_PAD,
): PackageRegion[] {
  const byColor = new Map<string, RegionPoint[]>();
  for (const p of points) {
    const group = byColor.get(p.color);
    if (group) group.push({ x: p.x, y: p.y });
    else byColor.set(p.color, [{ x: p.x, y: p.y }]);
  }
  const regions: PackageRegion[] = [];
  for (const [color, group] of byColor) {
    if (group.length < 3) continue;
    const hull = convexHull(group);
    if (hull.length < 3) continue;
    regions.push({ color, polygon: padOutward(hull, pad) });
  }
  return regions;
}
