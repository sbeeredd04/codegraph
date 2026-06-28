import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { docsCachePath } from "./cache-path.js";

describe("docsCachePath", () => {
  it("is deterministic for a root and independent of path spelling", () => {
    const a = docsCachePath("/repo/app");
    const b = docsCachePath("/repo/app/");
    const c = docsCachePath("/repo/./app");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.endsWith(path.join("docs.json"))).toBe(true);
  });

  it("differs by repo and honors a custom base dir", () => {
    expect(docsCachePath("/repo/a")).not.toBe(docsCachePath("/repo/b"));
    expect(docsCachePath("/repo/a", "/base").startsWith("/base")).toBe(true);
  });

  it("sits alongside but distinct from the diagram cache (separate file)", () => {
    const docs = docsCachePath("/repo/a", "/base");
    expect(docs).toContain("docs.json");
    expect(docs).not.toContain("diagrams.json");
  });

  // The writing agent and the reading board are separate processes; the MCP
  // launcher strips TMPDIR, so the path must not depend on it.
  it("is independent of TMPDIR so the agent's writes reach the board", () => {
    const saved = process.env.TMPDIR;
    try {
      process.env.TMPDIR = path.join(path.sep, "tmp", "one");
      const a = docsCachePath("/repo/a");
      process.env.TMPDIR = path.join(path.sep, "var", "two");
      expect(docsCachePath("/repo/a")).toBe(a);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
  });
});
