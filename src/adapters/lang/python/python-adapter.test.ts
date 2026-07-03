import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import * as path from "node:path";
import { createPythonAdapter } from "./index.js";
import type { LanguageAdapter } from "../../../core/ports.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

const SRC = [
  "def login(u):",
  "    return u",
  "",
  "class Auth:",
  "    def sign_in(self):",
  "        return 1",
  "    def sign_out(self):",
  "        return 2",
  "",
  "@decorator",
  "def decorated():",
  "    return 3",
  "",
].join("\n");

let adapter: LanguageAdapter;

beforeAll(async () => {
  adapter = await createPythonAdapter(wasmDir);
});

describe("PythonAdapter (tree-sitter skeleton)", () => {
  it("emits a module node with a py: address", () => {
    const { nodes } = adapter.parseFile("auth.py", SRC);
    expect(nodes.find((n) => n.kind === "module")?.address).toBe("py:auth.py");
  });

  it("emits function nodes, unwrapping decorators", () => {
    const { nodes } = adapter.parseFile("auth.py", SRC);
    const fns = nodes.filter((n) => n.kind === "function").map((n) => n.address).sort();
    expect(fns).toEqual(["py:auth.py#decorated", "py:auth.py#login"]);
  });

  it("emits a class node and its methods", () => {
    const { nodes } = adapter.parseFile("auth.py", SRC);
    expect(nodes.find((n) => n.kind === "class")?.address).toBe("py:auth.py#Auth");
    const methods = nodes.filter((n) => n.kind === "method").map((n) => n.address).sort();
    expect(methods).toEqual(["py:auth.py#Auth.sign_in", "py:auth.py#Auth.sign_out"]);
  });

  it("emits contains edges (module->class, class->method)", () => {
    const { edges } = adapter.parseFile("auth.py", SRC);
    const contains = edges.map((e) => `${e.from}=>${e.to}`);
    expect(contains).toContain("py:auth.py=>py:auth.py#Auth");
    expect(contains).toContain("py:auth.py#Auth=>py:auth.py#Auth.sign_in");
  });

  // FR-60: capture the leading docstring (first bare string in the body) into node.doc.
  it("captures a leading docstring as node.doc (FR-60)", () => {
    const withDoc = [
      '"""Module: the auth service."""',
      "def login(u):",
      '    """Log the user in and return them."""',
      "    return u",
      "class Svc:",
      '    """A service."""',
      "    def run(self):",
      "        return 1",
      "def bare():",
      "    return 2",
    ].join("\n");
    const { nodes } = adapter.parseFile("svc.py", withDoc);
    expect(nodes.find((n) => n.kind === "module")?.doc).toContain("the auth service");
    expect(nodes.find((n) => n.address === "py:svc.py#login")?.doc).toContain("Log the user in");
    expect(nodes.find((n) => n.address === "py:svc.py#Svc")?.doc).toContain("A service");
    expect(nodes.find((n) => n.address === "py:svc.py#Svc.run")).not.toHaveProperty("doc");
    expect(nodes.find((n) => n.address === "py:svc.py#bare")).not.toHaveProperty("doc");
  });

  // FR-82: capture a compact structural signature. Python's return_type field is the
  // BARE type, so the walker joins it with ` -> ` to mirror `def f(a: int) -> str:`.
  it("captures an annotated signature with params and return type (FR-82)", () => {
    const src = [
      "def login(u: str, remember: bool = False) -> User:",
      "    return u",
      "def bare(x):",
      "    return x",
      "class Svc:",
      "    def run(self, id: int) -> None:",
      "        return None",
      "    def plain(self, a, b):",
      "        return a",
    ].join("\n");
    const { nodes } = adapter.parseFile("svc.py", src);
    // Annotated params + return type, joined with the ` -> ` arrow.
    expect(nodes.find((n) => n.address === "py:svc.py#login")?.signature).toBe(
      "login(u: str, remember: bool = False) -> User",
    );
    expect(nodes.find((n) => n.address === "py:svc.py#Svc.run")?.signature).toBe("run(self, id: int) -> None");
    // Unannotated: just the bare param list, no arrow (return_type field absent).
    expect(nodes.find((n) => n.address === "py:svc.py#bare")?.signature).toBe("bare(x)");
    expect(nodes.find((n) => n.address === "py:svc.py#Svc.plain")?.signature).toBe("plain(self, a, b)");
  });

  it("declares its language", () => {
    expect(adapter.language).toBe("python");
  });
});
