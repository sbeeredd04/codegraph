import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolvePythonImportEdges, resolvePythonCallEdges, resolvePythonOverrideEdges } from "./pyright-edges.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-py-edges-"));
  fs.writeFileSync(path.join(dir, "b.py"), "def b():\n    return 1\n");
  fs.writeFileSync(path.join(dir, "a.py"), "from b import b\n\ndef a():\n    return b()\n");
  fs.writeFileSync(
    path.join(dir, "c.py"),
    "class S:\n    def run(self):\n        return self.help()\n    def help(self):\n        return 2\n",
  );
  // Cross-file inheritance (FR-97): base in one file, subclass in another.
  fs.writeFileSync(path.join(dir, "base.py"), "class BaseAdapter:\n    def send(self):\n        raise NotImplementedError\n");
  fs.writeFileSync(
    path.join(dir, "adapter.py"),
    "from base import BaseAdapter\n\nclass HTTPAdapter(BaseAdapter):\n    def send(self):\n        return 1\n",
  );
  // Dotted/imported-module base (`base.BaseAdapter`).
  fs.writeFileSync(
    path.join(dir, "sub.py"),
    "import base\n\nclass Dotted(base.BaseAdapter):\n    def send(self):\n        return 2\n",
  );
  // Same-file inheritance — the skeleton walker's job, this resolver must NOT emit it.
  fs.writeFileSync(
    path.join(dir, "samefile.py"),
    "class A:\n    def m(self):\n        return 1\n\nclass B(A):\n    def m(self):\n        return 2\n",
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolvePythonImportEdges (Pyright integration)", () => {
  it("resolves a cross-file import as a depends-on edge", async () => {
    const files = [path.join(dir, "a.py"), path.join(dir, "b.py")];
    const edges = await resolvePythonImportEdges(dir, files, wasmDir);
    expect(edges).toContainEqual({ from: "py:a.py", to: "py:b.py", type: "depends-on" });
  }, 30000);

  it("returns nothing when there are no Python files", async () => {
    const edges = await resolvePythonImportEdges(dir, [path.join(dir, "x.ts")], wasmDir);
    expect(edges).toEqual([]);
  });
});

describe("resolvePythonCallEdges (Pyright integration)", () => {
  const files = () => [path.join(dir, "a.py"), path.join(dir, "b.py"), path.join(dir, "c.py")];

  it("resolves a cross-file call (a -> b)", async () => {
    const edges = await resolvePythonCallEdges(dir, files(), wasmDir);
    expect(edges).toContainEqual({ from: "py:a.py#a", to: "py:b.py#b", type: "calls" });
  }, 30000);

  it("resolves an intra-class method call (S.run -> S.help)", async () => {
    const edges = await resolvePythonCallEdges(dir, files(), wasmDir);
    expect(edges).toContainEqual({ from: "py:c.py#S.run", to: "py:c.py#S.help", type: "calls" });
  }, 30000);
});

describe("resolvePythonOverrideEdges (Pyright integration)", () => {
  const files = () =>
    ["base.py", "adapter.py", "sub.py", "samefile.py"].map((f) => path.join(dir, f));

  it("resolves a cross-file override (HTTPAdapter.send -> BaseAdapter.send)", async () => {
    const edges = await resolvePythonOverrideEdges(dir, files(), wasmDir);
    expect(edges).toContainEqual({
      from: "py:adapter.py#HTTPAdapter.send",
      to: "py:base.py#BaseAdapter.send",
      type: "overrides",
    });
  }, 30000);

  it("resolves a dotted-base cross-file override (Dotted.send -> BaseAdapter.send)", async () => {
    const edges = await resolvePythonOverrideEdges(dir, files(), wasmDir);
    expect(edges).toContainEqual({
      from: "py:sub.py#Dotted.send",
      to: "py:base.py#BaseAdapter.send",
      type: "overrides",
    });
  }, 30000);

  it("does NOT emit same-file overrides (left to the skeleton walker)", async () => {
    const edges = await resolvePythonOverrideEdges(dir, files(), wasmDir);
    expect(edges).not.toContainEqual({
      from: "py:samefile.py#B.m",
      to: "py:samefile.py#A.m",
      type: "overrides",
    });
  }, 30000);
});
