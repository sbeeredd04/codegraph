import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapRepo } from "./bootstrap.js";

// These are heavy polyglot integration tests: each bootstrapRepo spins up Pyright
// over LSP (a cold start on the first) plus ts-morph. Under full-suite parallelism
// the cold start can exceed vitest's 5s default and flake the gate, though every
// test passes comfortably in isolation. Give the whole file generous headroom so
// CPU contention can't fail a green run.
vi.setConfig({ testTimeout: 30_000 });

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
  // Hidden tooling dirs (e.g. .claude, .bmad) must not pollute the graph or
  // stall Pyright on unrelated scripts — the source walk skips dot-directories.
  fs.mkdirSync(path.join(dir, ".tooling", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".tooling", "scripts", "gen.ts"), "export const gen = 1;\n");
  fs.writeFileSync(path.join(dir, ".tooling", "scripts", "tool.py"), "def t():\n    return 1\n");
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

  it("skips hidden dot-directories so tooling (.claude, .bmad) never enters the graph", async () => {
    const { coverage, graph } = await bootstrapRepo(dir, wasmDir);
    expect(coverage.found).toBe(3); // .tooling/gen.ts and .tooling/tool.py are excluded
    expect(graph.getNode("ts:.tooling/scripts/gen.ts")).toBeUndefined();
    expect(graph.getNode("py:.tooling/scripts/tool.py#t")).toBeUndefined();
  });

  it("respects the languages option (python disabled skips .py)", async () => {
    const { coverage, graph } = await bootstrapRepo(dir, wasmDir, { python: false });
    expect(coverage.found).toBe(2); // a.ts + b.ts only
    expect(graph.getNode("py:calc.py#Calc")).toBeUndefined();
  });
});

// FR-83: React-Native P0. Before this, `.jsx`/`.js` were excluded from the scan and
// `.tsx` mis-parsed under the plain-TS grammar, so arrow-function components + hooks
// (the bulk of an RN app) were invisible. This asserts the whole family is scanned,
// JSX parses cleanly, arrow components become nodes, and an arrow component that calls
// an arrow hook gets a real `calls` edge (ts-morph FR-83 endpoints).
describe("bootstrapRepo scans the JS/JSX family (FR-83)", () => {
  let rnDir: string;

  beforeAll(() => {
    rnDir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-rn-"));
    // A .tsx screen whose arrow component calls an arrow hook in the same file.
    fs.writeFileSync(
      path.join(rnDir, "App.tsx"),
      [
        "export const useLabel = (t: string): string => t.toUpperCase();",
        "export const App = (): string => {",
        "  return useLabel('hi');",
        "};",
        "",
      ].join("\n"),
    );
    // JSX living in a plain .js file — the classic RN gotcha the old scan skipped.
    fs.writeFileSync(path.join(rnDir, "Badge.js"), "export const Badge = () => 'badge';\n");
    // A .jsx file.
    fs.writeFileSync(path.join(rnDir, "Screen.jsx"), "export const Screen = () => null;\n");
  });

  afterAll(() => {
    fs.rmSync(rnDir, { recursive: true, force: true });
  });

  it("scans .tsx/.jsx/.js and parses them without failure", async () => {
    const { coverage } = await bootstrapRepo(rnDir, wasmDir, { python: false });
    expect(coverage.found).toBe(3); // App.tsx, Badge.js, Screen.jsx
    expect(coverage.parsed).toBe(3);
    expect(coverage.failed).toBe(0);
  });

  it("captures arrow-function components + hooks across the family", async () => {
    const { graph } = await bootstrapRepo(rnDir, wasmDir, { python: false });
    expect(graph.getNode("ts:App.tsx#App")?.kind).toBe("function");
    expect(graph.getNode("ts:App.tsx#useLabel")?.kind).toBe("function");
    expect(graph.getNode("ts:Badge.js#Badge")?.kind).toBe("function");
    expect(graph.getNode("ts:Screen.jsx#Screen")?.kind).toBe("function");
  });

  it("resolves a calls edge from an arrow component to the arrow hook it calls", async () => {
    const { graph } = await bootstrapRepo(rnDir, wasmDir, { python: false });
    // App -> useLabel is only found if arrow functions are both callers AND targets.
    expect(graph.neighbors("ts:App.tsx#App")).toContain("ts:App.tsx#useLabel");
  });
});

describe("bootstrapRepo honors .gitignore", () => {
  let gitDir: string;

  beforeAll(() => {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-gi-"));
    execFileSync("git", ["init", "-q"], { cwd: gitDir });
    fs.writeFileSync(path.join(gitDir, "real.ts"), "export const real = 1;\n");
    // A gitignored tooling dir (underscore-prefixed, so the dot-dir skip misses it).
    fs.mkdirSync(path.join(gitDir, "_tooling"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "_tooling", "gen.ts"), "export const gen = 1;\n");
    fs.writeFileSync(path.join(gitDir, ".gitignore"), "_tooling/\n");
  });

  afterAll(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it("excludes gitignored files so the scan matches the git baseline (no phantom diffs)", async () => {
    const { coverage, graph } = await bootstrapRepo(gitDir, wasmDir);
    expect(coverage.found).toBe(1); // real.ts only; _tooling/gen.ts is ignored
    expect(graph.getNode("ts:real.ts")?.kind).toBe("module");
    expect(graph.getNode("ts:_tooling/gen.ts")).toBeUndefined();
  });
});
