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

  // The writing agent and the reading board are separate processes; the MCP
  // launcher strips TMPDIR, so the path must not depend on it.
  it("is independent of TMPDIR so the agent's writes reach the board", () => {
    const saved = process.env.TMPDIR;
    try {
      process.env.TMPDIR = path.join(path.sep, "tmp", "one");
      const a = diagramsCachePath("/repo/a");
      process.env.TMPDIR = path.join(path.sep, "var", "two");
      expect(diagramsCachePath("/repo/a")).toBe(a);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
  });
});
