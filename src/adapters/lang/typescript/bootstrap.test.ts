import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapTypeScriptRepo } from "./bootstrap.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-boot-"));
  fs.writeFileSync(path.join(dir, "b.ts"), "export function b() { return 1; }\n");
  fs.writeFileSync(path.join(dir, "a.ts"), 'import { b } from "./b";\nexport function a() { return b(); }\n');
  fs.mkdirSync(path.join(dir, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "junk", "skip.ts"), "export const skip = 1;\n");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("bootstrapTypeScriptRepo (integration)", () => {
  it("builds a graph of all source files, skipping node_modules", async () => {
    const { graph, coverage } = await bootstrapTypeScriptRepo(dir, wasmDir);
    expect(coverage.found).toBe(2); // a.ts + b.ts; node_modules skipped
    expect(coverage.parsed).toBe(2);
    expect(coverage.failed).toBe(0);
    expect(graph.getNode("ts:a.ts")?.kind).toBe("module");
    expect(graph.getNode("ts:b.ts")?.kind).toBe("module");
  });

  it("resolves the cross-file depends-on edge (a -> b)", async () => {
    const { graph } = await bootstrapTypeScriptRepo(dir, wasmDir);
    expect(graph.neighbors("ts:a.ts")).toContain("ts:b.ts");
    // b is imported, so it is not an orphan; a (entry) is.
    expect(graph.orphans()).toContain("ts:a.ts");
    expect(graph.orphans()).not.toContain("ts:b.ts");
  });
});
