import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { NodeEnrichment } from "../../core/semantic/enrichment.js";
import { diskEnrichmentCache } from "./disk-cache.js";

const enrichment: NodeEnrichment = { summary: "s", intent: "i", role: "r" };

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-cache-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("diskEnrichmentCache", () => {
  it("returns undefined for an unknown key", async () => {
    const cache = diskEnrichmentCache(path.join(dir, "cache.json"));
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("persists a set value so a fresh cache instance reads it back", async () => {
    const file = path.join(dir, "cache.json");
    const a = diskEnrichmentCache(file);
    await a.set("k", enrichment);
    const b = diskEnrichmentCache(file); // new instance, same file
    expect(await b.get("k")).toEqual(enrichment);
  });

  it("creates the parent directory if it does not exist", async () => {
    const file = path.join(dir, "nested", "deep", "cache.json");
    const cache = diskEnrichmentCache(file);
    await cache.set("k", enrichment);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("starts empty (no throw) when the file is missing", async () => {
    const cache = diskEnrichmentCache(path.join(dir, "does-not-exist.json"));
    expect(await cache.get("k")).toBeUndefined();
  });

  it("starts empty (no throw) when the file is corrupt", async () => {
    const file = path.join(dir, "corrupt.json");
    fs.writeFileSync(file, "{ not valid json ");
    const cache = diskEnrichmentCache(file);
    expect(await cache.get("k")).toBeUndefined();
    // and remains usable for writes
    await cache.set("k", enrichment);
    expect(await cache.get("k")).toEqual(enrichment);
  });

  it("ignores malformed entries on load, keeping only well-formed enrichments", async () => {
    const file = path.join(dir, "mixed.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ good: enrichment, bad: { summary: 5 }, alsoBad: "nope" }),
    );
    const cache = diskEnrichmentCache(file);
    expect(await cache.get("good")).toEqual(enrichment);
    expect(await cache.get("bad")).toBeUndefined();
    expect(await cache.get("alsoBad")).toBeUndefined();
  });
});
