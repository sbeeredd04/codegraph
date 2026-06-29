import { describe, it, expect } from "vitest";
import { parseSignature } from "./signature.js";

describe("parseSignature", () => {
  it("splits a simple TS signature into params and a return type", () => {
    const s = parseSignature("addNumbers(a: number, b: number): number");
    expect(s).toEqual({
      params: [
        { name: "a", type: "number" },
        { name: "b", type: "number" },
      ],
      returns: "number",
    });
  });

  it("marks `?`-suffixed and default-valued params as optional, stripping the default", () => {
    const s = parseSignature("f(a: string, b?: number, c: boolean = true): void");
    expect(s?.params).toEqual([
      { name: "a", type: "string" },
      { name: "b", type: "number", optional: true },
      { name: "c", type: "boolean", optional: true },
    ]);
    expect(s?.returns).toBe("void");
  });

  it("does not split commas inside generics, object types, or arrow params", () => {
    const s = parseSignature(
      "h(m: Map<string, number>, o: { a: number, b: number }, cb: (e: Event) => void): Promise<void>",
    );
    expect(s?.params.map((p) => p.name)).toEqual(["m", "o", "cb"]);
    expect(s?.params[0].type).toBe("Map<string, number>");
    expect(s?.params[1].type).toBe("{ a: number, b: number }");
    expect(s?.params[2].type).toBe("(e: Event) => void");
    expect(s?.returns).toBe("Promise<void>");
  });

  it("handles a zero-parameter signature with a return type", () => {
    expect(parseSignature("getName(): string")).toEqual({ params: [], returns: "string" });
  });

  it("parses Python `->` return syntax and keeps rest/keyword params", () => {
    const s = parseSignature("run(self, *args: int, **kwargs) -> bool");
    expect(s?.params.map((p) => p.name)).toEqual(["self", "*args", "**kwargs"]);
    expect(s?.params[1].type).toBe("int");
    expect(s?.returns).toBe("bool");
  });

  it("keeps a param with no type annotation (name only)", () => {
    const s = parseSignature("legacy(a, b)");
    // No declared return and untyped params is still useful input shape.
    expect(s).toEqual({ params: [{ name: "a" }, { name: "b" }] });
  });

  it("drops a trailing function body brace and semicolon from the return type", () => {
    expect(parseSignature("f(): Promise<void> {")?.returns).toBe("Promise<void>");
    expect(parseSignature("f(): number;")?.returns).toBe("number");
  });

  it("returns null when there is nothing useful to show", () => {
    expect(parseSignature(undefined)).toBeNull();
    expect(parseSignature("")).toBeNull();
    expect(parseSignature("SomeClass")).toBeNull(); // no parens
    expect(parseSignature("noop()")).toBeNull(); // no params, no return
  });

  it("returns null for an unbalanced parameter list rather than throwing", () => {
    expect(parseSignature("broken(a: number")).toBeNull();
  });
});
