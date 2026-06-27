import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapRepo } from "./bootstrap.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-boot-"));
  fs.writeFileSync(path.join(dir, "b.ts"), "export function b() { return 1; }\n");
  fs.writeFileSync(path.join(dir, "a.ts"), 'import { b } from "./b";\nexport function a() { return b(); }\n');
  fs.writeFileSync(path.join(dir, "calc.py"), "class Calc:\n    def add(self, x):\n        return x\n");
  fs.mkdirSync(path.join(dir, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "junk", "skip.ts"), "export const skip = 1;\n");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("bootstrapRepo (polyglot integration)", () => {
  it("parses TS and Python, skipping node_modules", async () => {
    const { coverage } = await bootstrapRepo(dir, wasmDir);
    expect(coverage.found).toBe(3); // a.ts, b.ts, calc.py
    expect(coverage.parsed).toBe(3);
    expect(coverage.failed).toBe(0);
  });

  it("builds TS nodes + the cross-file depends-on edge", async () => {
    const { graph } = await bootstrapRepo(dir, wasmDir);
    expect(graph.getNode("ts:a.ts")?.kind).toBe("module");
    expect(graph.neighbors("ts:a.ts")).toContain("ts:b.ts");
  });

  it("builds Python class + method nodes under a py: address", async () => {
    const { graph } = await bootstrapRepo(dir, wasmDir);
    expect(graph.getNode("py:calc.py#Calc")?.kind).toBe("class");
    expect(graph.getNode("py:calc.py#Calc.add")?.kind).toBe("method");
  });
});
