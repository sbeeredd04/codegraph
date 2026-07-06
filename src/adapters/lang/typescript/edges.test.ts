import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { resolveImportEdges, resolveCallEdges, resolveRenderEdges, resolveOverrideEdges } from "./edges.js";

function projectWith(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [name, content] of Object.entries(files)) project.createSourceFile(name, content);
  return project;
}

describe("resolveImportEdges", () => {
  it("emits a depends-on edge between modules for a resolvable import", () => {
    const project = projectWith({
      "a.ts": `import { b } from "./b";\nexport const a = b;`,
      "b.ts": `export const b = 1;`,
    });
    const edges = resolveImportEdges(project, "/");
    expect(edges).toContainEqual({ from: "ts:a.ts", to: "ts:b.ts", type: "depends-on" });
  });

  it("skips external and unresolved imports", () => {
    const project = projectWith({
      "a.ts": `import * as fs from "node:fs";\nimport { x } from "./missing";`,
    });
    expect(resolveImportEdges(project, "/")).toEqual([]);
  });

  it("resolves nested relative imports across directories", () => {
    const project = projectWith({
      "src/index.ts": `import { q } from "./queue/queue";`,
      "src/queue/queue.ts": `export const q = 1;`,
    });
    const edges = resolveImportEdges(project, "/");
    expect(edges).toContainEqual({
      from: "ts:src/index.ts",
      to: "ts:src/queue/queue.ts",
      type: "depends-on",
    });
  });

  it("emits nothing for a file with no imports", () => {
    expect(resolveImportEdges(projectWith({ "solo.ts": `export const x = 1;` }), "/")).toEqual([]);
  });

  it("skips imports that resolve to a .d.ts / node_modules file (first-party graph only)", () => {
    const project = projectWith({
      "vendor.d.ts": `export declare const v: number;`,
      "a.ts": `import { v } from "./vendor";\nexport const a = v;`,
    });
    expect(resolveImportEdges(project, "/")).toEqual([]);
  });
});

describe("resolveCallEdges", () => {
  it("resolves intra-file function and method calls", () => {
    const project = projectWith({
      "a.ts": [
        "export function helper() { return 1; }",
        "export function main() { return helper(); }",
        "export class S { run() { return this.help(); } help() { return 2; } }",
      ].join("\n"),
    });
    const edges = resolveCallEdges(project, "/");
    expect(edges).toContainEqual({ from: "ts:a.ts#main", to: "ts:a.ts#helper", type: "calls" });
    expect(edges).toContainEqual({ from: "ts:a.ts#S.run", to: "ts:a.ts#S.help", type: "calls" });
  });

  it("resolves cross-file calls to the imported function", () => {
    const project = projectWith({
      "b.ts": "export function b() { return 1; }",
      "a.ts": 'import { b } from "./b";\nexport function a() { return b(); }',
    });
    expect(resolveCallEdges(project, "/")).toContainEqual({
      from: "ts:a.ts#a",
      to: "ts:b.ts#b",
      type: "calls",
    });
  });

  it("skips calls to external/library functions", () => {
    const project = projectWith({ "a.ts": "export function f() { console.log('x'); }" });
    expect(resolveCallEdges(project, "/")).toEqual([]);
  });
});

describe("resolveRenderEdges (FR-84)", () => {
  it("resolves a render edge to an imported component, skipping host elements", () => {
    const project = projectWith({
      "card.tsx": "export const Card = ({ t }: { t: string }) => t;",
      "screen.tsx": [
        "import { Card } from './card';",
        "export const Screen = () => {",
        "  return <View><Card t='hi' /><Text>x</Text></View>;",
        "};",
      ].join("\n"),
    });
    const edges = resolveRenderEdges(project, "/");
    // Screen renders the first-party Card; View/Text are unresolved host elements.
    expect(edges).toContainEqual({
      from: "ts:screen.tsx#Screen",
      to: "ts:card.tsx#Card",
      type: "calls",
      call: "render",
    });
    expect(edges).toHaveLength(1);
  });

  it("resolves a same-file render edge (function component renders an arrow component)", () => {
    const project = projectWith({
      "app.tsx": ["const Row = () => null;", "export function List() { return <Row />; }"].join("\n"),
    });
    expect(resolveRenderEdges(project, "/")).toContainEqual({
      from: "ts:app.tsx#List",
      to: "ts:app.tsx#Row",
      type: "calls",
      call: "render",
    });
  });

  it("emits nothing when a component renders only lowercase host elements", () => {
    const project = projectWith({ "h.tsx": "export const H = () => <div><span/></div>;" });
    expect(resolveRenderEdges(project, "/")).toEqual([]);
  });
});

describe("resolveOverrideEdges (FR-97 cross-file)", () => {
  it("resolves a cross-file override to the imported base method", () => {
    const project = projectWith({
      "base.ts": "export class BaseAdapter {\n  send() { return 1; }\n  close() {}\n}",
      "http.ts": [
        "import { BaseAdapter } from './base';",
        "export class HTTPAdapter extends BaseAdapter {",
        "  send() { return 2; }", // overrides BaseAdapter.send across files
        "  extra() {}", // not in the base — no edge
        "}",
      ].join("\n"),
    });
    const edges = resolveOverrideEdges(project, "/");
    expect(edges).toContainEqual({
      from: "ts:http.ts#HTTPAdapter.send",
      to: "ts:base.ts#BaseAdapter.send",
      type: "overrides",
    });
    // Only the redefined method produces an edge.
    expect(edges).toHaveLength(1);
  });

  it("does NOT emit same-file overrides (left to the skeleton walker)", () => {
    const project = projectWith({
      "solo.ts": ["class A { m() {} }", "class B extends A { m() {} }"].join("\n"),
    });
    // Base and override share a file — the skeleton owns this edge; ts-morph must not dup it.
    expect(resolveOverrideEdges(project, "/")).toEqual([]);
  });

  it("resolves a transitive cross-file override up the base chain", () => {
    const project = projectWith({
      "a.ts": "export class A {\n  run() {}\n}",
      "b.ts": "import { A } from './a';\nexport class B extends A {}", // B adds nothing
      "c.ts": [
        "import { B } from './b';",
        "export class C extends B {",
        "  run() {}", // overrides A.run through B (B doesn't define run)
        "}",
      ].join("\n"),
    });
    expect(resolveOverrideEdges(project, "/")).toContainEqual({
      from: "ts:c.ts#C.run",
      to: "ts:a.ts#A.run",
      type: "overrides",
    });
  });

  it("skips a base class from node_modules / .d.ts (first-party graph only)", () => {
    const project = projectWith({
      "vendor.d.ts": "export declare class Vendor {\n  handle(): void;\n}",
      "impl.ts": [
        "import { Vendor } from './vendor';",
        "export class Impl extends Vendor {",
        "  handle() {}",
        "}",
      ].join("\n"),
    });
    expect(resolveOverrideEdges(project, "/")).toEqual([]);
  });
});
