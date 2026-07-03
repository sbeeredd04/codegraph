import { describe, it, expect } from "vitest";
import {
  validatePresentationCommand,
  PRESENTATION_COMMAND_KINDS,
  type PresentationCommand,
} from "./command.js";

describe("validatePresentationCommand", () => {
  it("accepts a highlight_nodes command and defaults the style off", () => {
    const cmd = validatePresentationCommand({ kind: "highlight_nodes", addresses: ["a", "b"] });
    expect(cmd).toEqual({ kind: "highlight_nodes", addresses: ["a", "b"] });
  });

  it("keeps a valid highlight style and rejects an unknown one", () => {
    expect(validatePresentationCommand({ kind: "highlight_nodes", addresses: ["a"], style: "trace" })).toEqual({
      kind: "highlight_nodes",
      addresses: ["a"],
      style: "trace",
    });
    expect(
      validatePresentationCommand({ kind: "highlight_nodes", addresses: ["a"], style: "neon" }),
    ).toBeNull();
  });

  it("rejects an empty, oversized, or non-string address set (untrusted guard)", () => {
    expect(validatePresentationCommand({ kind: "highlight_nodes", addresses: [] })).toBeNull();
    expect(validatePresentationCommand({ kind: "focus_camera", addresses: [1, 2] })).toBeNull();
    const huge = Array.from({ length: 501 }, (_, i) => `n${i}`);
    expect(validatePresentationCommand({ kind: "highlight_nodes", addresses: huge })).toBeNull();
  });

  it("accepts highlight_path with both endpoints, rejects a missing one", () => {
    expect(validatePresentationCommand({ kind: "highlight_path", from: "a", to: "b" })).toEqual({
      kind: "highlight_path",
      from: "a",
      to: "b",
    });
    expect(validatePresentationCommand({ kind: "highlight_path", from: "a" })).toBeNull();
  });

  it("carries focus_camera's optional select flag only when boolean", () => {
    expect(validatePresentationCommand({ kind: "focus_camera", addresses: ["a"] })).toEqual({
      kind: "focus_camera",
      addresses: ["a"],
    });
    expect(validatePresentationCommand({ kind: "focus_camera", addresses: ["a"], select: false })).toEqual({
      kind: "focus_camera",
      addresses: ["a"],
      select: false,
    });
    expect(
      validatePresentationCommand({ kind: "focus_camera", addresses: ["a"], select: "yes" }),
    ).toBeNull();
  });

  it("validates the enum-backed commands against their vocabularies", () => {
    expect(validatePresentationCommand({ kind: "set_projection", projection: "call" })).toEqual({
      kind: "set_projection",
      projection: "call",
    });
    expect(validatePresentationCommand({ kind: "set_projection", projection: "spiral" })).toBeNull();

    expect(validatePresentationCommand({ kind: "open_panel", panel: "docs", open: false })).toEqual({
      kind: "open_panel",
      panel: "docs",
      open: false,
    });
    expect(validatePresentationCommand({ kind: "open_panel", panel: "nope" })).toBeNull();

    expect(validatePresentationCommand({ kind: "toggle_affordance", affordance: "orphans", on: true })).toEqual({
      kind: "toggle_affordance",
      affordance: "orphans",
      on: true,
    });
    expect(validatePresentationCommand({ kind: "toggle_affordance", affordance: "zoom" })).toBeNull();
  });

  it("validates replay: addresses required, dwellMs optional but finite", () => {
    expect(validatePresentationCommand({ kind: "replay", addresses: ["a", "b"] })).toEqual({
      kind: "replay",
      addresses: ["a", "b"],
    });
    expect(validatePresentationCommand({ kind: "replay", addresses: ["a"], dwellMs: 600 })).toEqual({
      kind: "replay",
      addresses: ["a"],
      dwellMs: 600,
    });
    expect(validatePresentationCommand({ kind: "replay", addresses: [] })).toBeNull();
    expect(validatePresentationCommand({ kind: "replay", addresses: ["a"], dwellMs: "fast" })).toBeNull();
    expect(validatePresentationCommand({ kind: "replay", addresses: ["a"], dwellMs: Number.NaN })).toBeNull();
  });

  it("validates reveal: a non-empty address is required (FR-78)", () => {
    expect(validatePresentationCommand({ kind: "reveal", address: "ts:src/a.ts#foo" })).toEqual({
      kind: "reveal",
      address: "ts:src/a.ts#foo",
    });
    expect(validatePresentationCommand({ kind: "reveal", address: "" })).toBeNull();
    expect(validatePresentationCommand({ kind: "reveal" })).toBeNull();
    expect(validatePresentationCommand({ kind: "reveal", address: 42 })).toBeNull();
  });

  it("drops malformed / unknown shapes rather than throwing", () => {
    expect(validatePresentationCommand(null)).toBeNull();
    expect(validatePresentationCommand("highlight_nodes")).toBeNull();
    expect(validatePresentationCommand({ kind: "unknown" })).toBeNull();
    expect(validatePresentationCommand({})).toBeNull();
  });

  it("round-trips every declared command kind through a representative value", () => {
    const samples: PresentationCommand[] = [
      { kind: "highlight_nodes", addresses: ["a"] },
      { kind: "highlight_path", from: "a", to: "b" },
      { kind: "focus_camera", addresses: ["a"] },
      { kind: "set_projection", projection: "full" },
      { kind: "open_panel", panel: "diagrams" },
      { kind: "toggle_affordance", affordance: "folders" },
      { kind: "replay", addresses: ["a", "b"] },
      { kind: "reveal", address: "ts:src/a.ts#foo" },
    ];
    expect(samples.map((s) => s.kind).sort()).toEqual([...PRESENTATION_COMMAND_KINDS].sort());
    for (const s of samples) expect(validatePresentationCommand(s)).toEqual(s);
  });
});
