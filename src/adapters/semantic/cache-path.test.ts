import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { enrichmentCachePath } from "./cache-path.js";

describe("enrichmentCachePath", () => {
  it("is deterministic for a given root (writer and reader meet)", () => {
    expect(enrichmentCachePath("/repo/a")).toBe(enrichmentCachePath("/repo/a"));
  });

  it("differs by repo root", () => {
    expect(enrichmentCachePath("/repo/a")).not.toBe(enrichmentCachePath("/repo/b"));
  });

  it("is independent of path spelling (resolves the root)", () => {
    expect(enrichmentCachePath("/repo/a")).toBe(enrichmentCachePath("/repo/./a"));
    expect(enrichmentCachePath("/repo/a")).toBe(enrichmentCachePath("/repo/a/"));
  });

  it("ends with enrichment.json", () => {
    expect(enrichmentCachePath("/repo/a").endsWith("enrichment.json")).toBe(true);
  });

  it("honours a custom base dir", () => {
    const p = enrichmentCachePath("/repo/a", path.join(path.sep, "tmp", "base"));
    expect(p.startsWith(path.join(path.sep, "tmp", "base"))).toBe(true);
    expect(p.endsWith("enrichment.json")).toBe(true);
  });
});
