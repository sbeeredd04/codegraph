import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { diagramsCachePath } from "./cache-path.js";

describe("diagramsCachePath", () => {
  it("is deterministic for a root and independent of path spelling", () => {
    const a = diagramsCachePath("/repo/app");
    const b = diagramsCachePath("/repo/app/");
    const c = diagramsCachePath("/repo/./app");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.endsWith(path.join("diagrams.json"))).toBe(true);
  });

  it("differs by repo and honors a custom base dir", () => {
    expect(diagramsCachePath("/repo/a")).not.toBe(diagramsCachePath("/repo/b"));
    expect(diagramsCachePath("/repo/a", "/base").startsWith("/base")).toBe(true);
  });

  it("sits alongside but distinct from the enrichment cache (separate file)", () => {
    expect(diagramsCachePath("/repo/a", "/base")).toContain("diagrams.json");
  });
});
