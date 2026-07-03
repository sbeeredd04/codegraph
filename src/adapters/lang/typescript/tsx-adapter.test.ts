import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import * as path from "node:path";
import { createTsxAdapter } from "./index.js";
import type { LanguageAdapter } from "../../../core/ports.js";

const require = createRequire(import.meta.url);
const wasmDir = path.dirname(require.resolve("@vscode/tree-sitter-wasm"));

// FR-83: React / React-Native files are dominated by JSX + arrow-function components
// and hooks. The plain-TS grammar mis-parses `<Component/>` and the walker never
// captured `const App = () => …`, so most of an RN app was invisible. The tsx adapter
// (tsx grammar + variableFunction capture) fixes both.
const RN_SRC = [
  "import { View, Text } from 'react-native';",
  "",
  "/** The root screen. */",
  "export const App = ({ title }: { title: string }): JSX.Element => {",
  "  const label = useLabel(title);",
  "  return <View><Text>{label}</Text></View>;",
  "};",
  "",
  "export const useLabel = (t: string): string => t.toUpperCase();",
  "",
  "function Plain(a: number): number { return a; }",
  "",
  "class Widget {",
  "  render() { return null; }",
  "}",
  "",
].join("\n");

let adapter: LanguageAdapter;

beforeAll(async () => {
  adapter = await createTsxAdapter(wasmDir);
});

describe("TsxAdapter (JSX + arrow-function capture, FR-83)", () => {
  it("parses JSX without a parse error and emits a module node", () => {
    const { nodes } = adapter.parseFile("App.tsx", RN_SRC);
    // A mis-parse (plain-TS grammar on JSX) would drop the declarations below; the
    // module node alone would remain. Assert the real declarations survived.
    expect(nodes.find((n) => n.kind === "module")?.address).toBe("ts:App.tsx");
    expect(nodes.length).toBeGreaterThan(3);
  });

  it("captures an arrow-function component as a function node", () => {
    const { nodes } = adapter.parseFile("App.tsx", RN_SRC);
    const app = nodes.find((n) => n.address === "ts:App.tsx#App");
    expect(app?.kind).toBe("function");
  });

  it("captures an arrow-function hook as a function node", () => {
    const { nodes } = adapter.parseFile("App.tsx", RN_SRC);
    expect(nodes.find((n) => n.address === "ts:App.tsx#useLabel")?.kind).toBe("function");
  });

  it("still captures plain declarations and classes alongside arrows", () => {
    const { nodes } = adapter.parseFile("App.tsx", RN_SRC);
    expect(nodes.find((n) => n.address === "ts:App.tsx#Plain")?.kind).toBe("function");
    expect(nodes.find((n) => n.address === "ts:App.tsx#Widget")?.kind).toBe("class");
    expect(nodes.find((n) => n.address === "ts:App.tsx#Widget.render")?.kind).toBe("method");
  });

  it("emits a contains edge from the module to each arrow function", () => {
    const { edges } = adapter.parseFile("App.tsx", RN_SRC);
    const contains = edges.filter((e) => e.type === "contains").map((e) => `${e.from}=>${e.to}`);
    expect(contains).toContain("ts:App.tsx=>ts:App.tsx#App");
    expect(contains).toContain("ts:App.tsx=>ts:App.tsx#useLabel");
  });

  it("captures the arrow component's structural signature (FR-82 fields work on arrows)", () => {
    const { nodes } = adapter.parseFile("App.tsx", RN_SRC);
    expect(nodes.find((n) => n.address === "ts:App.tsx#App")?.signature).toBe(
      "App({ title }: { title: string }): JSX.Element",
    );
    // A concise single-expression arrow with a return type.
    expect(nodes.find((n) => n.address === "ts:App.tsx#useLabel")?.signature).toBe("useLabel(t: string): string");
  });

  it("carries the arrow component's leading JSDoc into node.doc (FR-60)", () => {
    const { nodes } = adapter.parseFile("App.tsx", RN_SRC);
    expect(nodes.find((n) => n.address === "ts:App.tsx#App")?.doc).toContain("The root screen");
  });

  it("declares its language as tsx", () => {
    expect(adapter.language).toBe("tsx");
  });
});
