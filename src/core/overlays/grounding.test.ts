import { describe, it, expect } from "vitest";
import {
  emptyOverlaySet,
  nodeOverlays,
  upsertOverlay,
  validateNote,
  type OverlaySet,
} from "./overlay.js";
import { groundNodes, groundingCoverage } from "./grounding.js";

const known = new Set(["m:a", "m:b", "m:c"]);

/** A node note pinned to `address` with `body` — to seed/inspect a set. */
function noteOn(set: OverlaySet, address: string, body: string): OverlaySet {
  const r = validateNote({ anchor: { on: "node", address }, body });
  if (!r.ok) throw new Error(r.error);
  return upsertOverlay(set, r.overlay);
}

describe("groundNodes", () => {
  it("applies a valid grounding as a node note", () => {
    const r = groundNodes(emptyOverlaySet(), [{ address: "m:a", body: "Validates the token." }], known);
    expect(r.applied).toEqual(["m:a"]);
    expect(r.skipped).toEqual([]);
    expect(nodeOverlays(r.set, "m:a").note?.body).toBe("Validates the token.");
  });

  it("folds a whole batch in one pass", () => {
    const r = groundNodes(
      emptyOverlaySet(),
      [
        { address: "m:a", body: "Alpha." },
        { address: "m:b", body: "Beta." },
        { address: "m:c", body: "Gamma." },
      ],
      known,
    );
    expect(r.applied).toEqual(["m:a", "m:b", "m:c"]);
    expect(r.skipped).toEqual([]);
    expect(nodeOverlays(r.set, "m:b").note?.body).toBe("Beta.");
  });

  it("skips a grounding for an unknown address (reported, not stored)", () => {
    const r = groundNodes(emptyOverlaySet(), [{ address: "m:zzz", body: "ghost" }], known);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual([{ address: "m:zzz", reason: "unknown-address" }]);
    expect(r.set.overlays).toHaveLength(0);
  });

  it("skips an empty body as invalid, with the validator's detail", () => {
    const r = groundNodes(emptyOverlaySet(), [{ address: "m:a", body: "   " }], known);
    expect(r.applied).toEqual([]);
    expect(r.skipped[0]?.address).toBe("m:a");
    expect(r.skipped[0]?.reason).toBe("invalid");
    expect(r.skipped[0]?.detail).toBeTruthy();
  });

  it("skips an over-long body as invalid (the untrusted-input cap)", () => {
    const r = groundNodes(emptyOverlaySet(), [{ address: "m:a", body: "x".repeat(10_001) }], known);
    expect(r.skipped[0]?.reason).toBe("invalid");
    expect(r.set.overlays).toHaveLength(0);
  });

  it("treats a missing/non-string address as unknown", () => {
    const r = groundNodes(
      emptyOverlaySet(),
      [{ address: undefined as unknown as string, body: "x" }],
      known,
    );
    expect(r.skipped).toEqual([{ address: "", reason: "unknown-address" }]);
  });

  it("trims a padded address before matching the known set", () => {
    const r = groundNodes(emptyOverlaySet(), [{ address: "  m:a  ", body: "trimmed" }], known);
    expect(r.applied).toEqual(["m:a"]);
    expect(nodeOverlays(r.set, "m:a").note?.body).toBe("trimmed");
  });

  it("re-grounding a node replaces its note in place; a later input wins", () => {
    const r = groundNodes(
      emptyOverlaySet(),
      [
        { address: "m:a", body: "first" },
        { address: "m:a", body: "second" },
      ],
      known,
    );
    expect(r.applied).toEqual(["m:a"]); // deduped
    expect(r.set.overlays).toHaveLength(1);
    expect(nodeOverlays(r.set, "m:a").note?.body).toBe("second");
  });

  it("threads updatedAt onto the stored note", () => {
    const r = groundNodes(
      emptyOverlaySet(),
      [{ address: "m:a", body: "x", updatedAt: "2026-06-29T00:00:00.000Z" }],
      known,
    );
    expect(nodeOverlays(r.set, "m:a").note?.updatedAt).toBe("2026-06-29T00:00:00.000Z");
  });

  it("does not mutate the input set", () => {
    const input = emptyOverlaySet();
    groundNodes(input, [{ address: "m:a", body: "x" }], known);
    expect(input.overlays).toHaveLength(0);
  });

  it("returns the input set unchanged for an empty batch", () => {
    const input = emptyOverlaySet();
    const r = groundNodes(input, [], known);
    expect(r.set).toBe(input);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("reports a mixed batch accurately", () => {
    const r = groundNodes(
      emptyOverlaySet(),
      [
        { address: "m:a", body: "ok" },
        { address: "m:ghost", body: "nope" },
        { address: "m:b", body: " " },
        { address: "m:c", body: "ok2" },
      ],
      known,
    );
    expect(r.applied).toEqual(["m:a", "m:c"]);
    expect(r.skipped.map((s) => [s.address, s.reason])).toEqual([
      ["m:ghost", "unknown-address"],
      ["m:b", "invalid"],
    ]);
  });
});

describe("groundingCoverage", () => {
  it("reports zero coverage and every node ungrounded for an empty set", () => {
    const c = groundingCoverage(emptyOverlaySet(), known);
    expect(c).toEqual({ grounded: 0, total: 3, ungrounded: ["m:a", "m:b", "m:c"] });
  });

  it("counts grounded nodes and lists the rest in known order", () => {
    const set = groundNodes(
      emptyOverlaySet(),
      [
        { address: "m:a", body: "x" },
        { address: "m:c", body: "y" },
      ],
      known,
    ).set;
    const c = groundingCoverage(set, known);
    expect(c.grounded).toBe(2);
    expect(c.total).toBe(3);
    expect(c.ungrounded).toEqual(["m:b"]);
  });

  it("ignores a note pinned to an edge", () => {
    const r = validateNote({
      anchor: { on: "edge", from: "m:a", to: "m:b", type: "calls" },
      body: "edge note",
    });
    if (!r.ok) throw new Error(r.error);
    const c = groundingCoverage(upsertOverlay(emptyOverlaySet(), r.overlay), known);
    expect(c.grounded).toBe(0);
  });

  it("ignores a stale node note whose address is no longer in the graph", () => {
    const set = noteOn(emptyOverlaySet(), "m:gone", "left over");
    const c = groundingCoverage(set, known);
    expect(c.grounded).toBe(0);
    expect(c.ungrounded).toEqual(["m:a", "m:b", "m:c"]); // the stale one is not a target
  });
});
