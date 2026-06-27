import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { baselineGraph } from "./baseline.js";
import { bootstrapRepo } from "../lang/bootstrap.js";
import { diffGraphs } from "../../core/graph/diff.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-git-"));
  const git = (...args: string[]): void => void execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "t@t.co");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.ts"), "export function foo() { return 1; }\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  // Working-tree edit AFTER the commit: a new function the baseline doesn't have.
  fs.writeFileSync(
    path.join(dir, "a.ts"),
    "export function foo() { return 1; }\nexport function bar() { return 2; }\n",
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("baselineGraph (git integration)", () => {
  it("captures the committed baseline, not the working tree", async () => {
    const baseline = await baselineGraph(dir, "HEAD", wasmDir);
    expect(baseline.getNode("ts:a.ts#foo")?.kind).toBe("function");
    expect(baseline.getNode("ts:a.ts#bar")).toBeUndefined(); // bar is only in the working tree
  });

  it("does not disturb the working tree (read-only, FR-9)", async () => {
    await baselineGraph(dir, "HEAD", wasmDir);
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString();
    expect(status).toContain("a.ts"); // the working-tree edit is still uncommitted, untouched
  });

  it("diffing the working tree against HEAD surfaces the new function", async () => {
    const baseline = await baselineGraph(dir, "HEAD", wasmDir);
    const { graph: working } = await bootstrapRepo(dir, wasmDir);
    const delta = diffGraphs(baseline, working);
    expect(delta.added.map((n) => n.address)).toContain("ts:a.ts#bar");
  });

  it("rejects an unknown ref", async () => {
    await expect(baselineGraph(dir, "no-such-ref", wasmDir)).rejects.toThrow();
  });

  it("rejects an option-like ref (argument-injection guard)", async () => {
    await expect(baselineGraph(dir, "--upload-pack=evil", wasmDir)).rejects.toThrow();
  });
});
