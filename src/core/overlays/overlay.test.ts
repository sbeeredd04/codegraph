import { describe, it, expect } from "vitest";
import {
  OVERLAY_SET_VERSION,
  MARK_KINDS,
  validateNote,
  validateMark,
  validateGroup,
  validateOverlay,
  noteId,
  markId,
  groupId,
  emptyOverlaySet,
  upsertOverlay,
  removeOverlay,
  parseOverlaySet,
  nodeOverlays,
  overlaysByKind,
  overlayHighlights,
  type Note,
  type Mark,
  type Group,
} from "./overlay.js";

const note = (over: Partial<{ anchor: unknown; body: unknown }> = {}): Note => {
  const r = validateNote({
    anchor: { on: "node", address: "ts:src/a.ts#f" },
    body: "what happened: it throws on null input.",
    ...over,
  });
  if (!r.ok) throw new Error(r.error);
  return r.overlay as Note;
};

describe("validateNote", () => {
  it("accepts a node-anchored note and derives a stable id", () => {
    const n = note();
    expect(n.kind).toBe("note");
    expect(n.anchor).toEqual({ on: "node", address: "ts:src/a.ts#f" });
    expect(n.id).toBe(noteId({ on: "node", address: "ts:src/a.ts#f" }));
  });

  it("accepts an edge-anchored note with a known edge type", () => {
    const r = validateNote({
      anchor: { on: "edge", from: "ts:src/a.ts#f", to: "ts:src/b.ts#g", type: "calls" },
      body: "this call is the hot path.",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.overlay.anchor).toEqual({
      on: "edge",
      from: "ts:src/a.ts#f",
      to: "ts:src/b.ts#g",
      type: "calls",
    });
  });

  it("rejects a missing anchor, an empty body, and an unknown edge type", () => {
    expect(validateNote({ body: "x" }).ok).toBe(false);
    expect(validateNote({ anchor: { on: "node", address: "ts:a#f" }, body: "   " }).ok).toBe(false);
    expect(
      validateNote({
        anchor: { on: "edge", from: "a", to: "b", type: "teleports-to" },
        body: "x",
      }).ok,
    ).toBe(false);
  });

  it("caps an oversize body", () => {
    expect(validateNote({ anchor: { on: "node", address: "ts:a#f" }, body: "x".repeat(10_001) }).ok).toBe(
      false,
    );
  });

  it("ids by anchor identity, not body — two bodies on one node share an id (upsert)", () => {
    const a = note({ body: "first" });
    const b = note({ body: "second, rewritten" });
    expect(a.id).toBe(b.id);
  });
});

describe("validateMark", () => {
  it("accepts each known mark kind on a node", () => {
    for (const kind of MARK_KINDS) {
      const r = validateMark({ address: "ts:src/a.ts#f", mark: kind });
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.overlay as Mark).mark).toBe(kind);
    }
  });

  it("keeps a known severity and label, drops an unknown severity", () => {
    const r = validateMark({ address: "ts:a#f", mark: "bug", severity: "error", label: "off-by-one" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.overlay as Mark;
      expect(m.severity).toBe("error");
      expect(m.label).toBe("off-by-one");
    }
    const bad = validateMark({ address: "ts:a#f", mark: "bug", severity: "catastrophic" });
    expect(bad.ok).toBe(true);
    if (bad.ok) expect((bad.overlay as Mark).severity).toBeUndefined();
  });

  it("rejects a missing address or an unknown kind", () => {
    expect(validateMark({ mark: "bug" }).ok).toBe(false);
    expect(validateMark({ address: "ts:a#f", mark: "smell" }).ok).toBe(false);
  });

  it("ids by (address, kind) so one node can carry distinct kinds but re-marks upsert", () => {
    expect(markId("ts:a#f", "bug")).not.toBe(markId("ts:a#f", "todo"));
    expect(markId("ts:a#f", "bug")).toBe(markId("ts:a#f", "bug"));
  });
});

describe("validateGroup", () => {
  it("accepts a labelled set of member addresses", () => {
    const r = validateGroup({ label: "Auth flow", members: ["ts:a#f", "ts:b#g", ""] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const g = r.overlay as Group;
      expect(g.label).toBe("Auth flow");
      expect(g.members).toEqual(["ts:a#f", "ts:b#g"]); // empty member dropped
      expect(g.id).toBe(groupId("Auth flow"));
    }
  });

  it("rejects a missing label or an empty member list", () => {
    expect(validateGroup({ members: ["ts:a#f"] }).ok).toBe(false);
    expect(validateGroup({ label: "Empty", members: [] }).ok).toBe(false);
    expect(validateGroup({ label: "Empty", members: ["", "  "] }).ok).toBe(false);
  });

  it("group id is case/space-insensitive on the label (re-saving updates members)", () => {
    expect(groupId("Auth Flow")).toBe(groupId("  auth flow "));
  });
});

describe("validateOverlay (the parse/load dispatch)", () => {
  it("dispatches on kind and rejects unknown or non-object shapes", () => {
    expect(validateOverlay({ kind: "note", anchor: { on: "node", address: "a" }, body: "x" }).ok).toBe(true);
    expect(validateOverlay({ kind: "mark", address: "a", mark: "bug" }).ok).toBe(true);
    expect(validateOverlay({ kind: "group", label: "G", members: ["a"] }).ok).toBe(true);
    expect(validateOverlay({ kind: "wat" }).ok).toBe(false);
    expect(validateOverlay(null).ok).toBe(false);
    expect(validateOverlay("nope").ok).toBe(false);
  });
});

describe("immutable set ops", () => {
  it("upsert inserts then replaces by id, never mutating the input", () => {
    const empty = emptyOverlaySet();
    expect(empty.version).toBe(OVERLAY_SET_VERSION);
    const one = upsertOverlay(empty, note({ body: "first" }));
    expect(empty.overlays).toHaveLength(0); // input untouched
    expect(one.overlays).toHaveLength(1);
    const two = upsertOverlay(one, note({ body: "rewritten" }));
    expect(two.overlays).toHaveLength(1); // same anchor id → replaced
    expect((two.overlays[0] as Note).body).toBe("rewritten");
  });

  it("remove drops by id and is a no-op when absent", () => {
    const set = upsertOverlay(emptyOverlaySet(), note());
    const id = set.overlays[0].id;
    expect(removeOverlay(set, id).overlays).toHaveLength(0);
    expect(removeOverlay(set, "nope").overlays).toHaveLength(1);
  });
});

describe("parseOverlaySet", () => {
  it("round-trips a serialized set and tolerates malformed entries", () => {
    const set = [
      validateNote({ anchor: { on: "node", address: "ts:a#f" }, body: "ok" }),
      validateMark({ address: "ts:a#f", mark: "bug" }),
    ]
      .map((r) => (r.ok ? r.overlay : null))
      .filter(Boolean);
    const text = JSON.stringify({ version: 1, overlays: [...set, { kind: "junk" }, 42] });
    const parsed = parseOverlaySet(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.set.overlays).toHaveLength(2); // junk + 42 dropped
  });

  it("fails calmly on non-JSON or a non-object", () => {
    expect(parseOverlaySet("{ not json").ok).toBe(false);
    expect(parseOverlaySet("[]").ok).toBe(false);
    expect(parseOverlaySet('{"version":1}').ok).toBe(false); // no overlays array
  });
});

describe("query helpers", () => {
  const must = (r: { ok: true; overlay: Note | Mark | Group } | { ok: false; error: string }) => {
    if (!r.ok) throw new Error(r.error);
    return r.overlay;
  };

  it("nodeOverlays collects the node's note, marks, and the groups it belongs to", () => {
    let set = emptyOverlaySet();
    set = upsertOverlay(set, note({ anchor: { on: "node", address: "ts:a#f" }, body: "note on f" }));
    set = upsertOverlay(set, must(validateMark({ address: "ts:a#f", mark: "bug" })));
    set = upsertOverlay(set, must(validateGroup({ label: "G", members: ["ts:a#f", "ts:b#g"] })));
    const got = nodeOverlays(set, "ts:a#f");
    expect(got.note?.body).toBe("note on f");
    expect(got.marks.map((m) => m.mark)).toEqual(["bug"]);
    expect(got.groups.map((g) => g.label)).toEqual(["G"]);
    // A node in no group / with no note comes back empty.
    expect(nodeOverlays(set, "ts:b#g").note).toBeUndefined();
    expect(nodeOverlays(set, "ts:b#g").groups.map((g) => g.label)).toEqual(["G"]);
  });

  it("overlaysByKind partitions a set into notes/marks/groups", () => {
    let set = emptyOverlaySet();
    set = upsertOverlay(set, note());
    const m = validateMark({ address: "ts:a#f", mark: "todo" });
    if (m.ok) set = upsertOverlay(set, m.overlay);
    const g = validateGroup({ label: "G", members: ["ts:a#f"] });
    if (g.ok) set = upsertOverlay(set, g.overlay);
    const by = overlaysByKind(set);
    expect(by.notes).toHaveLength(1);
    expect(by.marks).toHaveLength(1);
    expect(by.groups).toHaveLength(1);
  });

  it("overlayHighlights resolves the dominant mark per node and the grouped set", () => {
    let set = emptyOverlaySet();
    set = upsertOverlay(set, must(validateMark({ address: "ts:a#f", mark: "hotspot", severity: "warn" })));
    set = upsertOverlay(set, must(validateGroup({ label: "G", members: ["ts:a#f", "ts:b#g"] })));
    const hl = overlayHighlights(set);
    expect(hl.marks.get("ts:a#f")?.mark).toBe("hotspot");
    // Both group members are grouped; the unmarked one carries no mark.
    expect(hl.grouped.has("ts:a#f")).toBe(true);
    expect(hl.grouped.has("ts:b#g")).toBe(true);
    expect(hl.marks.has("ts:b#g")).toBe(false);
  });

  it("overlayHighlights ranks severity over kind, then earlier MARK_KINDS first", () => {
    let set = emptyOverlaySet();
    // A high-severity todo must beat a no-severity bug (severity dominates).
    set = upsertOverlay(set, must(validateMark({ address: "ts:a#f", mark: "todo", severity: "error" })));
    set = upsertOverlay(set, must(validateMark({ address: "ts:a#f", mark: "bug" })));
    expect(overlayHighlights(set).marks.get("ts:a#f")?.mark).toBe("todo");

    // At equal (absent) severity, the earlier MARK_KINDS entry wins: bug before todo.
    let tie = emptyOverlaySet();
    tie = upsertOverlay(tie, must(validateMark({ address: "ts:c#h", mark: "todo" })));
    tie = upsertOverlay(tie, must(validateMark({ address: "ts:c#h", mark: "bug" })));
    expect(MARK_KINDS.indexOf("bug")).toBeLessThan(MARK_KINDS.indexOf("todo"));
    expect(overlayHighlights(tie).marks.get("ts:c#h")?.mark).toBe("bug");
  });
});
