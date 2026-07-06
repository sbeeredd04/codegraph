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

  // FR-60: capture the leading JSDoc/comment into node.doc for the docstring-fallback
  // note. The raw comment (delimiters intact) is stored; @core/docs/doc-note cleans it.
  it("captures a leading JSDoc/comment as node.doc (FR-60)", () => {
    const withDoc = [
      "/** Signs a user in and returns them. */",
      "export function login(u) { return u; }",
      "function bare() {}",
      "class Svc {",
      "  // a plain leading comment",
      "  run() {}",
      "}",
    ].join("\n");
    const { nodes } = adapter.parseFile("src/svc.ts", withDoc);
    expect(nodes.find((n) => n.address === "ts:src/svc.ts#login")?.doc).toContain("Signs a user in");
    expect(nodes.find((n) => n.address === "ts:src/svc.ts#Svc.run")?.doc).toContain("a plain leading comment");
    // A node with no leading comment carries no doc (the field is omitted, not empty).
    expect(nodes.find((n) => n.address === "ts:src/svc.ts#bare")).not.toHaveProperty("doc");
  });

  // FR-82: capture a compact structural signature (typed params + return type) so
  // parseSignature (FR-59 IO), the trace-step view (T8.8), and the lookup haystack
  // all light up. It's STRUCTURAL (types, not source bytes), so it rides the portable
  // snapshot (AD-14) — verified NOT stripped in export.test.ts.
  it("captures a typed signature with params and return type (FR-82)", () => {
    const src = [
      "export function login(u: string, remember?: boolean): Promise<User> { return u; }",
      "function bare(x) { return x; }",
      "class Svc {",
      "  run(id: number): void {}",
      "  noAnnotations(a, b) {}",
      "}",
    ].join("\n");
    const { nodes } = adapter.parseFile("src/svc.ts", src);
    // Typed params + return type: TS's return_type field already carries the `: `.
    expect(nodes.find((n) => n.address === "ts:src/svc.ts#login")?.signature).toBe(
      "login(u: string, remember?: boolean): Promise<User>",
    );
    // A method with a typed param + return type.
    expect(nodes.find((n) => n.address === "ts:src/svc.ts#Svc.run")?.signature).toBe("run(id: number): void");
    // Untyped params, no return type: just the bare param list — still useful arity.
    expect(nodes.find((n) => n.address === "ts:src/svc.ts#bare")?.signature).toBe("bare(x)");
    expect(nodes.find((n) => n.address === "ts:src/svc.ts#Svc.noAnnotations")?.signature).toBe("noAnnotations(a, b)");
  });

  // FR-97: same-file inheritance → `overrides` edge from a subclass method that redefines
  // an inherited method to the base method (virtual-dispatch resolution). TS bases live in
  // a `class_heritage` → `extends_clause` → `value`, distinct from Python's `superclasses`.
  it("emits an overrides edge for a same-file subclass method (FR-97)", () => {
    const src = [
      "class Base {",
      "  send() { return 1; }",
      "  close() {}",
      "}",
      "export class HTTP extends Base {", // exported subclass — unwrap must reach it
      "  send() { return 2; }", // overrides Base.send
      "  extra() {}", // not in the base — no override edge
      "}",
    ].join("\n");
    const { edges } = adapter.parseFile("src/net.ts", src);
    const overrides = edges.filter((e) => e.type === "overrides").map((e) => `${e.from}=>${e.to}`);
    expect(overrides).toContain("ts:src/net.ts#HTTP.send=>ts:src/net.ts#Base.send");
    // A subclass-only method and an unrelated base method do not produce override edges.
    expect(overrides).not.toContain("ts:src/net.ts#HTTP.extra=>ts:src/net.ts#Base.close");
    expect(overrides.some((o) => o.startsWith("ts:src/net.ts#HTTP.extra"))).toBe(false);
  });

  // FR-97 boundary: a dotted/imported base (`extends mod.Base`, a member_expression) is
  // NOT resolved same-file — that needs the type layer, so no override edge is emitted.
  it("does NOT emit overrides for a dotted (cross-module) base (FR-97)", () => {
    const src = [
      "import * as mod from './mod';",
      "class Sub extends mod.Base {",
      "  send() {}",
      "}",
    ].join("\n");
    const { edges } = adapter.parseFile("src/sub.ts", src);
    expect(edges.filter((e) => e.type === "overrides")).toEqual([]);
  });
});
