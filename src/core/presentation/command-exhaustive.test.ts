import { describe, it, expect } from "vitest";
import { validatePresentationCommand, type PresentationCommand } from "./command.js";

// A minimal VALID raw payload for every PresentationCommand kind. Typed as a Record
// over the union's `kind`, so adding a new command kind WITHOUT a fixture here fails to
// COMPILE — which forces you to also wire a validator case (the test below feeds each
// through validatePresentationCommand and asserts it round-trips). This closes the
// "a new command kind silently never validates" gap: the validator's tolerant
// `default: return null` can't be relied on to reject a member that SHOULD be accepted.
const VALID: Record<PresentationCommand["kind"], Record<string, unknown>> = {
  highlight_nodes: { kind: "highlight_nodes", addresses: ["ts:a.ts#f"] },
  highlight_path: { kind: "highlight_path", from: "ts:a.ts#f", to: "ts:a.ts#g" },
  focus_camera: { kind: "focus_camera", addresses: ["ts:a.ts#f"] },
  set_projection: { kind: "set_projection", projection: "full" },
  open_panel: { kind: "open_panel", panel: "detail" },
  toggle_affordance: { kind: "toggle_affordance", affordance: "orphans" },
  replay: { kind: "replay", addresses: ["ts:a.ts#f"] },
  reveal: { kind: "reveal", address: "ts:a.ts#f" },
};

describe("validatePresentationCommand exhaustiveness (T11.2)", () => {
  it("accepts a valid payload for EVERY command kind (a new kind must be added above)", () => {
    for (const [kind, raw] of Object.entries(VALID)) {
      const cmd = validatePresentationCommand(raw);
      expect(cmd, `kind "${kind}" should validate`).not.toBeNull();
      expect(cmd?.kind).toBe(kind);
    }
  });

  it("rejects an unknown kind (the tolerant boundary still holds)", () => {
    expect(validatePresentationCommand({ kind: "does_not_exist" })).toBeNull();
    expect(validatePresentationCommand({})).toBeNull();
  });
});
