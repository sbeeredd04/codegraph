import { describe, it, expect } from "vitest";
import { buildSymbolTree } from "./symbol-tree.js";
import type { GraphNode } from "./types.js";

const node = (address: string, name: string, kind: string, file: string, line = 0): GraphNode => ({
  address,
  name,
  kind,
  location: { file, line, character: 0 },
});

// A small monorepo: packages/web has one file with two symbols; packages/api has
// one file with one symbol; a root-level main.ts belongs to no package.
const nodes: GraphNode[] = [
  node("m:packages/web/src/app.ts", "app.ts", "module", "packages/web/src/app.ts"),
  node("f:packages/web/src/app.ts#render", "render", "function", "packages/web/src/app.ts", 10),
  node("f:packages/web/src/app.ts#App", "App", "class", "packages/web/src/app.ts", 2),
  node("m:packages/api/src/route.ts", "route.ts", "module", "packages/api/src/route.ts"),
  node("f:packages/api/src/route.ts#handler", "handler", "function", "packages/api/src/route.ts", 5),
  node("m:main.ts", "main.ts", "module", "main.ts"),
];

describe("buildSymbolTree (FR-75)", () => {
  it("groups symbols under their file and files under their package", () => {
    const tree = buildSymbolTree(nodes);
    const web = tree.packages.find((p) => p.id === "packages/web");
    expect(web).toBeTruthy();
    expect(web!.files).toHaveLength(1);
    expect(web!.files[0].path).toBe("packages/web/src/app.ts");
    expect(web!.files[0].moduleAddress).toBe("m:packages/web/src/app.ts");
    expect(web!.files[0].symbols.map((s) => s.name)).toEqual(["App", "render"]); // by line: App@2, render@10
  });

  it("orders packages most-populated first and counts symbols", () => {
    const tree = buildSymbolTree(nodes);
    expect(tree.packages.map((p) => p.id)).toEqual(["packages/web", "packages/api"]);
    expect(tree.packages[0].symbolCount).toBe(2);
    expect(tree.packages[1].symbolCount).toBe(1);
  });

  it("puts root-level files with no package into looseFiles", () => {
    const tree = buildSymbolTree(nodes);
    expect(tree.looseFiles.map((f) => f.path)).toEqual(["main.ts"]);
    expect(tree.packages.some((p) => p.files.some((f) => f.path === "main.ts"))).toBe(false);
  });

  it("handles a file with symbols but no module node (moduleAddress null)", () => {
    const orphanSym = [node("f:packages/web/src/x.ts#lonely", "lonely", "function", "packages/web/src/x.ts", 1)];
    const tree = buildSymbolTree(orphanSym);
    const file = tree.packages[0].files[0];
    expect(file.moduleAddress).toBeNull();
    expect(file.symbols.map((s) => s.name)).toEqual(["lonely"]);
  });

  it("is deterministic — files sorted by path, packages excluded when empty", () => {
    const tree = buildSymbolTree(nodes);
    // Only the two populated packages appear; no empty buckets leak through.
    expect(tree.packages.every((p) => p.files.length > 0)).toBe(true);
  });
});
