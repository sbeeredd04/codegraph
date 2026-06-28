import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { overlaysCachePath } from "./cache-path.js";

describe("overlaysCachePath", () => {
  it("is deterministic for a root and independent of path spelling", () => {
    const a = overlaysCachePath("/repo/app");
    const b = overlaysCachePath("/repo/app/");
    const c = overlaysCachePath("/repo/./app");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.endsWith(path.join("overlays.json"))).toBe(true);
  });

  it("differs by repo and honors a custom base dir", () => {
    expect(overlaysCachePath("/repo/a")).not.toBe(overlaysCachePath("/repo/b"));
    expect(overlaysCachePath("/repo/a", "/base").startsWith("/base")).toBe(true);
  });

  it("sits alongside but distinct from the doc + diagram caches (separate file)", () => {
    const overlays = overlaysCachePath("/repo/a", "/base");
    expect(overlays).toContain("overlays.json");
    expect(overlays).not.toContain("docs.json");
    expect(overlays).not.toContain("diagrams.json");
  });

  // The writing agent and the reading board are separate processes; the MCP
  // launcher strips TMPDIR, so the path must not depend on it.
  it("is independent of TMPDIR so the agent's writes reach the board", () => {
    const saved = process.env.TMPDIR;
    try {
      process.env.TMPDIR = path.join(path.sep, "tmp", "one");
      const a = overlaysCachePath("/repo/a");
      process.env.TMPDIR = path.join(path.sep, "var", "two");
      expect(overlaysCachePath("/repo/a")).toBe(a);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
  });
});
