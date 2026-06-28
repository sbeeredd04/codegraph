import { describe, it, expect } from "vitest";
import { folderOf, clusterByFolder, convexHull, type FolderNode, type Vec2 } from "./folder-layout.js";

describe("folderOf", () => {
  it("returns the directory portion of a repo-relative path", () => {
    expect(folderOf("src/auth/login.ts")).toBe("src/auth");
    expect(folderOf("a/b/c/d.ts")).toBe("a/b/c");
  });

  it("returns the empty string for a root-level file", () => {
    expect(folderOf("index.ts")).toBe("");
    expect(folderOf("")).toBe("");
  });
});

describe("clusterByFolder", () => {
  const twoFolders: FolderNode[] = [
    { id: "a1", file: "src/a/one.ts", x: 0, y: 0 },
    { id: "a2", file: "src/a/two.ts", x: 2, y: 0 },
    { id: "b1", file: "src/b/one.ts", x: 0, y: 1 },
    { id: "b2", file: "src/b/two.ts", x: 2, y: 1 },
  ];

  it("returns nothing for an empty graph", () => {
    const r = clusterByFolder([]);
    expect(r.positions.size).toBe(0);
    expect(r.folders).toEqual([]);
  });

  it("preserves intra-folder structure (rigid translation, any strength)", () => {
    const r = clusterByFolder(twoFolders, 0.7);
    // a1 and a2 are in the same folder, so their relative offset is unchanged.
    const a1 = r.positions.get("a1")!;
    const a2 = r.positions.get("a2")!;
    expect(a2.x - a1.x).toBeCloseTo(2, 10);
    expect(a2.y - a1.y).toBeCloseTo(0, 10);
  });

  it("lands each folder's centroid on its anchor at strength 1", () => {
    const r = clusterByFolder(twoFolders, 1);
    for (const { folder, anchor } of r.folders) {
      const members = twoFolders.filter((n) => n.file.startsWith(`${folder}/`));
      const cx = members.reduce((s, m) => s + r.positions.get(m.id)!.x, 0) / members.length;
      const cy = members.reduce((s, m) => s + r.positions.get(m.id)!.y, 0) / members.length;
      expect(cx).toBeCloseTo(anchor.x, 6);
      expect(cy).toBeCloseTo(anchor.y, 6);
    }
  });

  it("separates distinct folders (their anchors differ)", () => {
    const r = clusterByFolder(twoFolders);
    expect(r.folders.map((f) => f.folder)).toEqual(["src/a", "src/b"]); // sorted, stable
    const [fa, fb] = r.folders;
    expect(Math.hypot(fa.anchor.x - fb.anchor.x, fa.anchor.y - fb.anchor.y)).toBeGreaterThan(0);
  });

  it("is deterministic — same input yields identical positions", () => {
    const a = clusterByFolder(twoFolders);
    const b = clusterByFolder(twoFolders);
    for (const id of ["a1", "a2", "b1", "b2"]) {
      expect(a.positions.get(id)).toEqual(b.positions.get(id));
    }
  });

  it("reports each folder's centroid + a hull enclosing its clustered members (FR-26)", () => {
    const r = clusterByFolder(twoFolders);
    for (const region of r.folders) {
      const placed = twoFolders
        .filter((n) => n.file.startsWith(`${region.folder}/`))
        .map((n) => r.positions.get(n.id)!);
      // Centroid is the mean of the placed members.
      const mx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
      const my = placed.reduce((s, p) => s + p.y, 0) / placed.length;
      expect(region.centroid.x).toBeCloseTo(mx, 9);
      expect(region.centroid.y).toBeCloseTo(my, 9);
      // Every placed member lies inside (or on) the reported hull's bounding box.
      const xs = region.hull.map((p) => p.x);
      const ys = region.hull.map((p) => p.y);
      for (const p of placed) {
        expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
        expect(p.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
        expect(p.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
      }
    }
  });
});

describe("convexHull", () => {
  it("returns the deduplicated points as-is for fewer than 3 distinct inputs", () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
    expect(convexHull([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]); // co-located
    expect(convexHull([{ x: 0, y: 0 }, { x: 2, y: 2 }])).toEqual([{ x: 0, y: 0 }, { x: 2, y: 2 }]);
  });

  it("drops interior + collinear points, keeping only the extreme corners", () => {
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 2, y: 2 }, // interior — must be dropped
      { x: 2, y: 0 }, // on the bottom edge (collinear) — must be dropped
    ];
    const hull = convexHull(pts);
    expect(hull).toHaveLength(4);
    const set = new Set(hull.map((p) => `${p.x},${p.y}`));
    expect(set).toEqual(new Set(["0,0", "4,0", "4,4", "0,4"]));
    expect(set.has("2,2")).toBe(false);
  });

  it("winds counter-clockwise (positive signed area)", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    let area2 = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    expect(area2).toBeGreaterThan(0); // CCW
  });

  it("is deterministic regardless of input order", () => {
    const a = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    const b = convexHull([
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(a).toEqual(b);
  });
});
