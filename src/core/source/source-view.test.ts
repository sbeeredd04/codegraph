import { describe, it, expect } from "vitest";
import { buildSourceView } from "./source-view.js";

describe("buildSourceView (FR-15 node source viewer)", () => {
  it("splits text into lines and anchors on the 0-based def line", () => {
    const view = buildSourceView("a\nb\nc\nd", 2);
    expect(view.lines).toEqual(["a", "b", "c", "d"]);
    expect(view.anchor).toBe(2); // the 'c' line
    expect(view.lineCount).toBe(4);
  });

  it("clamps a def line past the end to the last line", () => {
    const view = buildSourceView("a\nb", 99);
    expect(view.anchor).toBe(1);
  });

  it("clamps a negative def line to the first line", () => {
    const view = buildSourceView("a\nb\nc", -5);
    expect(view.anchor).toBe(0);
  });

  it("truncates a fractional def line rather than indexing between lines", () => {
    const view = buildSourceView("a\nb\nc", 1.9);
    expect(view.anchor).toBe(1);
  });

  it("treats empty text as a single empty line anchored at 0", () => {
    const view = buildSourceView("", 0);
    expect(view.lines).toEqual([""]);
    expect(view.anchor).toBe(0);
    expect(view.lineCount).toBe(1);
  });

  it("preserves a trailing newline as a final empty line", () => {
    const view = buildSourceView("a\nb\n", 0);
    expect(view.lines).toEqual(["a", "b", ""]);
    expect(view.lineCount).toBe(3);
  });
});
