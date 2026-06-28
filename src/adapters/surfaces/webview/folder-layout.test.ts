import { describe, it, expect } from "vitest";
import { folderOf, clusterByFolder, type FolderNode } from "./folder-layout.js";

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
});
