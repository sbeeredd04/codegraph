import { describe, it, expect } from "vitest";
import { nodeHiddenAtRatio } from "./lod.js";

describe("nodeHiddenAtRatio", () => {
  it("far out: only modules visible", () => {
    expect(nodeHiddenAtRatio("module", 2)).toBe(false);
    expect(nodeHiddenAtRatio("class", 2)).toBe(true);
    expect(nodeHiddenAtRatio("function", 2)).toBe(true);
    expect(nodeHiddenAtRatio("method", 2)).toBe(true);
  });

  it("mid: hide methods, show the rest", () => {
    expect(nodeHiddenAtRatio("module", 1)).toBe(false);
    expect(nodeHiddenAtRatio("class", 1)).toBe(false);
    expect(nodeHiddenAtRatio("function", 1)).toBe(false);
    expect(nodeHiddenAtRatio("method", 1)).toBe(true);
  });

  it("near: everything visible", () => {
    for (const k of ["module", "class", "function", "method", "workflow"] as const) {
      expect(nodeHiddenAtRatio(k, 0.4)).toBe(false);
    }
  });
});
