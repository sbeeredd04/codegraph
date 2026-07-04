import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { newestSourceMtimeMs } from "./bootstrap.js";

describe("newestSourceMtimeMs (FR-93 freshness)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns the newest mtime among source files", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-mtime-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(dir, "b.py"), "x = 1\n");
    // Bump b.py's mtime into the future so it's unambiguously the newest.
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(dir, "b.py"), future, future);

    const newest = newestSourceMtimeMs(dir);
    expect(newest).toBeDefined();
    expect(newest!).toBeGreaterThanOrEqual(fs.statSync(path.join(dir, "b.py")).mtimeMs);
  });

  it("ignores non-source files and dot-dirs", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-mtime-"));
    fs.writeFileSync(path.join(dir, "README.md"), "# not source");
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "config"), "junk");
    expect(newestSourceMtimeMs(dir)).toBeUndefined();
  });

  it("honors a disabled family (python off → .py ignored)", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-mtime-"));
    fs.writeFileSync(path.join(dir, "only.py"), "x = 1\n");
    expect(newestSourceMtimeMs(dir, { python: false })).toBeUndefined();
    expect(newestSourceMtimeMs(dir, { python: true })).toBeDefined();
  });
});
