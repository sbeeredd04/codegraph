// Folder clustering (FR-26). A pure, deterministic re-placement of an already
// force-laid-out graph so nodes that live in the same source directory gather
// into their own region — turning a connectivity hairball into a folder map. The
// hard part (anchor assignment + rigid per-folder translation) lives here, unit
// tested, so the canvas stays a thin shell that just swaps in the new positions.

/** Directory portion of a repo-relative file path ("" for a root-level file). */
export function folderOf(file: string): string {
  const i = file.lastIndexOf("/");
  return i < 0 ? "" : file.slice(0, i);
}

export interface FolderNode {
  readonly id: string;
  readonly file: string;
  readonly x: number;
  readonly y: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A clustered folder's geometry, for drawing its outline + name label (FR-26). */
export interface FolderRegion {
  readonly folder: string;
  /** Deterministic phyllotaxis target the cluster was translated toward. */
  readonly anchor: Vec2;
  readonly count: number;
  /** Centroid of the folder's CLUSTERED member positions (label anchor). */
  readonly centroid: Vec2;
  /**
   * Convex hull of the clustered member positions, CCW. A 1–2 node folder (or
   * fully-collinear members) yields fewer than 3 points — the renderer then
   * draws just the label, no outline.
   */
  readonly hull: Vec2[];
}

export interface FolderClusterResult {
  /** New position per node id. */
  readonly positions: Map<string, Vec2>;
  /** Per-folder geometry, in stable (sorted) order — for outlines + labels. */
  readonly folders: FolderRegion[];
}

/**
 * Convex hull of a point set (Andrew's monotone chain) — pure + deterministic.
 * Returns the hull vertices counter-clockwise. Degenerate inputs (fewer than 3
 * distinct points, or all-collinear) return the deduplicated extreme points as
 * given, so callers must treat a <3-point result as "no fillable outline".
 */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  // Drop exact duplicates so a pile of co-located nodes can't wedge the scan.
  const uniq: Vec2[] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) uniq.push(p);
  }
  if (uniq.length < 3) return uniq;

  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Vec2[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  // Drop each list's last point (it's the other list's first) and concatenate.
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// The golden angle gives an even, non-overlapping phyllotaxis spread of anchors.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Re-place the graph so each folder's nodes gather around a deterministic anchor.
 * Folders are ordered by name (stable), each assigned a phyllotaxis anchor on a
 * disc sized from the layout's own extent (so it scales with the graph and with
 * the number of folders). A folder's whole cluster is then *rigidly translated*
 * from its current centroid toward its anchor by `strength` — preserving the
 * intra-folder structure the force layout found while separating the folders.
 *
 * Pure and deterministic (no RNG). `strength` 0 leaves positions unchanged; 1
 * lands each folder's centroid exactly on its anchor.
 */
export function clusterByFolder(
  nodes: readonly FolderNode[],
  strength = 0.85,
): FolderClusterResult {
  const positions = new Map<string, Vec2>();
  if (nodes.length === 0) return { positions, folders: [] };

  const byFolder = new Map<string, FolderNode[]>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const f = folderOf(n.file);
    const bucket = byFolder.get(f);
    if (bucket) bucket.push(n);
    else byFolder.set(f, [n]);
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }

  const folderNames = [...byFolder.keys()].sort();
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  // A disc a little larger than the original layout, growing with folder count so
  // many folders still get elbow room.
  const spread = extent * (0.55 + 0.12 * Math.sqrt(folderNames.length));

  const folders: FolderRegion[] = [];
  folderNames.forEach((folder, i) => {
    const members = byFolder.get(folder)!;
    const r = folderNames.length === 1 ? 0 : spread * Math.sqrt((i + 0.5) / folderNames.length);
    const a = i * GOLDEN_ANGLE;
    const anchor: Vec2 = { x: centerX + r * Math.cos(a), y: centerY + r * Math.sin(a) };

    let cx = 0;
    let cy = 0;
    for (const m of members) {
      cx += m.x;
      cy += m.y;
    }
    cx /= members.length;
    cy /= members.length;

    const dx = (anchor.x - cx) * strength;
    const dy = (anchor.y - cy) * strength;
    const placed: Vec2[] = [];
    for (const m of members) {
      const p = { x: m.x + dx, y: m.y + dy };
      positions.set(m.id, p);
      placed.push(p);
    }

    // The cluster's geometry, derived from where the members actually LAND, so the
    // outline + label track the rigidly-translated cluster (not the bare anchor).
    folders.push({
      folder,
      anchor,
      count: members.length,
      centroid: { x: cx + dx, y: cy + dy },
      hull: convexHull(placed),
    });
  });

  return { positions, folders };
}
