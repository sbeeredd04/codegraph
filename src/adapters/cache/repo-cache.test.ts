import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { codegraphCacheBase, repoCacheFile } from "./repo-cache.js";

const savedTmp = process.env.TMPDIR;
const savedOverride = process.env.CODEGRAPH_CACHE_DIR;
afterEach(() => {
  if (savedTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmp;
  if (savedOverride === undefined) delete process.env.CODEGRAPH_CACHE_DIR;
  else process.env.CODEGRAPH_CACHE_DIR = savedOverride;
});

describe("codegraphCacheBase", () => {
  it("anchors on the home directory by default, not the temp dir", () => {
    delete process.env.CODEGRAPH_CACHE_DIR;
    expect(codegraphCacheBase().startsWith(os.homedir())).toBe(true);
  });

  it("honours an explicit CODEGRAPH_CACHE_DIR override", () => {
    process.env.CODEGRAPH_CACHE_DIR = path.join(path.sep, "shared", "cg");
    expect(codegraphCacheBase()).toBe(path.join(path.sep, "shared", "cg"));
  });

  // The regression: the extension host and the MCP server are SEPARATE processes,
  // and the MCP SDK spawns the server with a stripped env (no TMPDIR). os.tmpdir()
  // then diverges (/tmp vs /var/folders on macOS) and the shared cache silently
  // splits. The base must NOT move when TMPDIR changes.
  it("is independent of TMPDIR (the two processes must agree)", () => {
    delete process.env.CODEGRAPH_CACHE_DIR;
    process.env.TMPDIR = path.join(path.sep, "tmp", "one");
    const a = codegraphCacheBase();
    process.env.TMPDIR = path.join(path.sep, "var", "folders", "two");
    const b = codegraphCacheBase();
    expect(a).toBe(b);
  });
});

describe("repoCacheFile", () => {
  it("is deterministic per root and independent of path spelling", () => {
    expect(repoCacheFile("/repo/a", "x.json")).toBe(repoCacheFile("/repo/./a", "x.json"));
    expect(repoCacheFile("/repo/a", "x.json")).toBe(repoCacheFile("/repo/a/", "x.json"));
  });

  it("differs by root and by file name", () => {
    expect(repoCacheFile("/repo/a", "x.json")).not.toBe(repoCacheFile("/repo/b", "x.json"));
    expect(repoCacheFile("/repo/a", "x.json")).not.toBe(repoCacheFile("/repo/a", "y.json"));
  });

  it("sits under the base and ends with the requested file name", () => {
    const base = path.join(path.sep, "base");
    const p = repoCacheFile("/repo/a", "x.json", base);
    expect(p.startsWith(base)).toBe(true);
    expect(p.endsWith("x.json")).toBe(true);
  });

  it("resolves to the same path across processes with different TMPDIR", () => {
    delete process.env.CODEGRAPH_CACHE_DIR;
    process.env.TMPDIR = path.join(path.sep, "tmp", "one");
    const a = repoCacheFile("/repo/a", "diagrams.json");
    process.env.TMPDIR = path.join(path.sep, "var", "folders", "two");
    const b = repoCacheFile("/repo/a", "diagrams.json");
    expect(a).toBe(b);
  });
});
