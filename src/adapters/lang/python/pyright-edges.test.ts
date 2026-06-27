import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolvePythonImportEdges, resolvePythonCallEdges } from "./pyright-edges.js";

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
