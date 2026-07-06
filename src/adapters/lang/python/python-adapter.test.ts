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

  // FR-85: Python depth — nested defs, decorators/routes, dataclass fields.
  const DEPTH_SRC = [
    "@app.get('/users')",
    "async def list_users(limit: int = 10) -> list:",
    "    def paginate(n):",
    "        return n",
    "    return paginate(limit)",
    "",
    "@dataclass",
    "class Config:",
    "    name: str",
    "    count: int = 0",
    "    untyped = 5",
    "    def load(self) -> None:",
    "        pass",
    "",
    "class Svc:",
    "    @property",
    "    def val(self) -> int:",
    "        return 1",
  ].join("\n");

  it("captures a nested def as a #outer.inner function node (FR-85)", () => {
    const { nodes, edges } = adapter.parseFile("api.py", DEPTH_SRC);
    expect(nodes.find((n) => n.address === "py:api.py#list_users.paginate")?.kind).toBe("function");
    // Contained by the outer function, not the module.
    const contains = edges.map((e) => `${e.from}=>${e.to}`);
    expect(contains).toContain("py:api.py#list_users=>py:api.py#list_users.paginate");
  });

  it("captures decorators AD-14-safe (route with its literal path, bare @property) (FR-85)", () => {
    const { nodes } = adapter.parseFile("api.py", DEPTH_SRC);
    expect(nodes.find((n) => n.address === "py:api.py#list_users")?.decorators).toEqual(["app.get('/users')"]);
    expect(nodes.find((n) => n.address === "py:api.py#Config")?.decorators).toEqual(["dataclass"]);
    expect(nodes.find((n) => n.address === "py:api.py#Svc.val")?.decorators).toEqual(["property"]);
    // An undecorated function carries no decorators field.
    expect(nodes.find((n) => n.address === "py:api.py#list_users.paginate")).not.toHaveProperty("decorators");
  });

  it("synthesizes a dataclass's typed fields into the class signature, skipping untyped (FR-85)", () => {
    const { nodes } = adapter.parseFile("api.py", DEPTH_SRC);
    // Only typed fields; `untyped = 5` (no annotation) is excluded.
    expect(nodes.find((n) => n.address === "py:api.py#Config")?.signature).toBe("Config(name: str, count: int = 0)");
  });

  // FR-97: same-file inheritance → `overrides` edges (subclass method → base method),
  // closing the virtual-dispatch gap the agent benchmark surfaced. The subclass is
  // declared BEFORE its base here to prove resolution runs after the whole file is walked.
  const INHERIT_SRC = [
    "class HTTPAdapter(BaseAdapter):",
    "    def send(self, request):",
    "        return 1",
    "    def close(self):",
    "        return 2",
    "",
    "class BaseAdapter:",
    "    def send(self, request):",
    "        raise NotImplementedError",
    "",
    "class Imported(some.module.Base):",
    "    def send(self):",
    "        return 3",
  ].join("\n");

  it("emits overrides edges for same-file inheritance only (FR-97)", () => {
    const { edges } = adapter.parseFile("adapters.py", INHERIT_SRC);
    const overrides = edges.filter((e) => e.type === "overrides").map((e) => `${e.from}=>${e.to}`).sort();
    // send() overrides BaseAdapter.send (subclass precedes base → resolved post-walk).
    // close() has no inherited counterpart; Imported's dotted base is cross-file → skipped.
    expect(overrides).toEqual(["py:adapters.py#HTTPAdapter.send=>py:adapters.py#BaseAdapter.send"]);
  });

  it("resolves an override through a transitive same-file base chain (FR-97)", () => {
    const src = [
      "class A:",
      "    def run(self):",
      "        return 1",
      "class B(A):",
      "    pass",
      "class C(B):",
      "    def run(self):",
      "        return 2",
    ].join("\n");
    const { edges } = adapter.parseFile("chain.py", src);
    const overrides = edges.filter((e) => e.type === "overrides").map((e) => `${e.from}=>${e.to}`);
    // C.run overrides A.run through B (B defines no run) — nearestBaseMethod walks the chain.
    expect(overrides).toEqual(["py:chain.py#C.run=>py:chain.py#A.run"]);
  });

  it("declares its language", () => {
    expect(adapter.language).toBe("python");
  });
});
