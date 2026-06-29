import { describe, it, expect } from "vitest";
import { partitionByPackage } from "./package.js";
import type { GraphNode } from "./types.js";

const mod = (address: string, file: string): GraphNode => ({
  address,
  kind: "module",
  name: file.split("/").pop() ?? file,
  location: { file, line: 0, character: 0 },
});

describe("partitionByPackage", () => {
  it("splits a packages/* monorepo into named packages", () => {
    const { packages, of } = partitionByPackage([
      mod("a", "packages/web/src/main.ts"),
      mod("b", "packages/web/src/app.ts"),
      mod("c", "packages/server/src/index.ts"),
    ]);
    expect(packages.map((p) => p.id)).toEqual(["packages/web", "packages/server"]);
    expect(packages[0]).toMatchObject({ id: "packages/web", label: "web", count: 2 });
    expect(packages[1]).toMatchObject({ id: "packages/server", label: "server", count: 1 });
    expect(of.get("a")).toBe("packages/web");
    expect(of.get("c")).toBe("packages/server");
  });

  it("recognizes apps/ and services/ container conventions", () => {
    const { packages } = partitionByPackage([
      mod("a", "apps/site/page.tsx"),
      mod("b", "services/api/handler.ts"),
    ]);
    expect(packages.map((p) => p.id).sort()).toEqual(["apps/site", "services/api"]);
    expect(packages.find((p) => p.id === "apps/site")?.label).toBe("site");
  });

  it("falls back to the top-level directory for a flat repo", () => {
    const { packages, of } = partitionByPackage([
      mod("a", "frontend/components/explorer.tsx"),
      mod("b", "frontend/lib/util.ts"),
      mod("c", "src/core/graph/types.ts"),
    ]);
    expect(packages.map((p) => p.id)).toEqual(["frontend", "src"]); // frontend(2) before src(1)
    expect(packages[0]).toMatchObject({ id: "frontend", label: "frontend", count: 2 });
    expect(of.get("c")).toBe("src");
  });

  it("orders by count desc then id, deterministically on ties", () => {
    const { packages } = partitionByPackage([
      mod("a", "zeta/one.ts"),
      mod("b", "alpha/one.ts"),
    ]);
    // Both count 1 → tie broken by id ascending.
    expect(packages.map((p) => p.id)).toEqual(["alpha", "zeta"]);
  });

  it("omits root-level files that have no enclosing package", () => {
    const { packages, of } = partitionByPackage([
      mod("a", "main.ts"),
      mod("b", "packages/web/x.ts"),
    ]);
    expect(of.has("a")).toBe(false);
    expect(packages.map((p) => p.id)).toEqual(["packages/web"]);
  });

  it("treats a container dir with no package name as a flat top-level area", () => {
    // `packages/x.ts` (only 2 segments) is NOT a package container — `packages`
    // itself becomes the top-level area, since there's no `<container>/<name>/…`.
    const { packages } = partitionByPackage([mod("a", "packages/x.ts")]);
    expect(packages).toEqual([{ id: "packages", label: "packages", count: 1 }]);
  });

  it("returns an empty partition for an empty graph", () => {
    expect(partitionByPackage([])).toEqual({ packages: [], of: new Map() });
  });
});
