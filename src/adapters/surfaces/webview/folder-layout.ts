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

export interface FolderClusterResult {
  /** New position per node id. */
  readonly positions: Map<string, Vec2>;
  /** Per-folder anchor + member count, in stable (sorted) order — for labelling. */
  readonly folders: { readonly folder: string; readonly anchor: Vec2; readonly count: number }[];
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

  const folders: { folder: string; anchor: Vec2; count: number }[] = [];
  folderNames.forEach((folder, i) => {
    const members = byFolder.get(folder)!;
    const r = folderNames.length === 1 ? 0 : spread * Math.sqrt((i + 0.5) / folderNames.length);
    const a = i * GOLDEN_ANGLE;
    const anchor: Vec2 = { x: centerX + r * Math.cos(a), y: centerY + r * Math.sin(a) };
    folders.push({ folder, anchor, count: members.length });

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
    for (const m of members) positions.set(m.id, { x: m.x + dx, y: m.y + dy });
  });

  return { positions, folders };
}
