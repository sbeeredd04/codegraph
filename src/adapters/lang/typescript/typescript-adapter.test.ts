import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import * as path from "node:path";
import { createTypeScriptAdapter } from "./index.js";
import type { LanguageAdapter } from "../../../core/ports.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

const SRC = [
  "export function login(u) { return u; }",
  "function helper() {}",
  "class Auth {",
  "  signIn() {}",
  "  signOut() {}",
  "}",
  "",
].join("\n");

let adapter: LanguageAdapter;

beforeAll(async () => {
  adapter = await createTypeScriptAdapter(wasmDir);
});

describe("TypeScriptAdapter (tree-sitter skeleton)", () => {
  it("emits a module node for the file", () => {
    const { nodes } = adapter.parseFile("src/auth.ts", SRC);
    expect(nodes.find((n) => n.kind === "module")?.address).toBe("ts:src/auth.ts");
  });

  it("emits function nodes (exported and not)", () => {
    const { nodes } = adapter.parseFile("src/auth.ts", SRC);
    const fns = nodes.filter((n) => n.kind === "function").map((n) => n.address).sort();
    expect(fns).toEqual(["ts:src/auth.ts#helper", "ts:src/auth.ts#login"]);
  });

  it("emits a class node and its method nodes", () => {
    const { nodes } = adapter.parseFile("src/auth.ts", SRC);
    expect(nodes.find((n) => n.kind === "class")?.address).toBe("ts:src/auth.ts#Auth");
    const methods = nodes.filter((n) => n.kind === "method").map((n) => n.address).sort();
    expect(methods).toEqual(["ts:src/auth.ts#Auth.signIn", "ts:src/auth.ts#Auth.signOut"]);
  });

  it("emits contains edges (module->decl, class->method)", () => {
    const { edges } = adapter.parseFile("src/auth.ts", SRC);
    const contains = edges.filter((e) => e.type === "contains").map((e) => `${e.from}=>${e.to}`);
    expect(contains).toContain("ts:src/auth.ts=>ts:src/auth.ts#login");
    expect(contains).toContain("ts:src/auth.ts#Auth=>ts:src/auth.ts#Auth.signIn");
  });

  it("records 0-based source location (AD-10)", () => {
    const { nodes } = adapter.parseFile("src/auth.ts", SRC);
    // `helper` is on the second line (row 1, 0-based).
    expect(nodes.find((n) => n.address.endsWith("#helper"))?.location.line).toBe(1);
  });

  it("declares its language", () => {
    expect(adapter.language).toBe("typescript");
  });
});
