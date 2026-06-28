import { describe, it, expect } from "vitest";
import { buildOnboardPlaybook, type OnboardContext } from "./playbook.js";
import { emptyDiagramSet, upsertDiagram, validateDiagram, type DiagramSet } from "../diagrams/diagram.js";
import { emptyDocSet, upsertDoc, validateDoc, type DocSet } from "../docs/doc.js";
import { emptyOverlaySet, upsertOverlay, validateMark, validateNote, type OverlaySet } from "../overlays/overlay.js";
import type { GraphStats } from "../graph/query.js";

const STATS: GraphStats = {
  nodeCount: 3,
  edgeCount: 2,
  byKind: { module: 1, class: 0, function: 2, method: 0, workflow: 0 },
};
const EMPTY_STATS: GraphStats = { nodeCount: 0, edgeCount: 0, byKind: { module: 0, class: 0, function: 0, method: 0, workflow: 0 } };

function diagramSet(...cats: ReadonlyArray<readonly [string, string]>): DiagramSet {
  let set = emptyDiagramSet();
  for (const [category, title] of cats) {
    const r = validateDiagram({ title, category, mermaid: "graph LR\nA-->B" });
    if (r.ok) set = upsertDiagram(set, r.diagram);
  }
  return set;
}
function docSet(...titles: ReadonlyArray<readonly [string, string]>): DocSet {
  let set = emptyDocSet();
  for (const [category, title] of titles) {
    const r = validateDoc({ title, category, markdown: "# x\n\ny." });
    if (r.ok) set = upsertDoc(set, r.doc);
  }
  return set;
}
function overlaySetWithMark(address: string, mark: string): OverlaySet {
  const r = validateMark({ address, mark });
  return r.ok ? upsertOverlay(emptyOverlaySet(), r.overlay) : emptyOverlaySet();
}
function overlaySetWithNote(address: string, body: string): OverlaySet {
  const r = validateNote({ anchor: { on: "node", address }, body });
  return r.ok ? upsertOverlay(emptyOverlaySet(), r.overlay) : emptyOverlaySet();
}

const fresh = (over: Partial<OnboardContext> = {}): OnboardContext => ({
  stats: STATS,
  diagrams: emptyDiagramSet(),
  docs: emptyDocSet(),
  overlays: emptyOverlaySet(),
  ...over,
});

describe("buildOnboardPlaybook (FR-42)", () => {
  it("a freshly-indexed repo has the index step done and every authoring step todo", () => {
    const plan = buildOnboardPlaybook(fresh());
    expect(plan.indexed).toBe(true);
    expect(plan.total).toBe(6);
    expect(plan.done).toBe(1); // only "index"
    expect(plan.complete).toBe(false);
    const byId = new Map(plan.steps.map((s) => [s.id, s.status]));
    expect(byId.get("index")).toBe("done");
    expect(byId.get("architecture-diagram")).toBe("todo");
    expect(byId.get("overview-doc")).toBe("todo");
    expect(byId.get("hotspots")).toBe("todo");
  });

  it("the summary reports the graph shape and the unchecked checklist", () => {
    const plan = buildOnboardPlaybook(fresh());
    expect(plan.summary).toContain("1/6 steps complete");
    expect(plan.summary).toContain("3 nodes, 2 edges (1 module, 2 functions)");
    expect(plan.summary).toContain("[x] Index the repository");
    expect(plan.summary).toContain("[ ] Draft the architecture diagram");
    expect(plan.summary).toContain("Next: Draft the architecture diagram");
  });

  it("an unindexed (empty) graph marks index todo and says so", () => {
    const plan = buildOnboardPlaybook(fresh({ stats: EMPTY_STATS }));
    expect(plan.indexed).toBe(false);
    expect(plan.done).toBe(0);
    expect(plan.steps[0]).toMatchObject({ id: "index", status: "todo" });
    expect(plan.summary).toContain("isn't indexed yet");
  });

  it("is IDEMPOTENT — already-authored artifacts flip their step to done", () => {
    const plan = buildOnboardPlaybook(
      fresh({
        diagrams: diagramSet(["architecture", "System architecture"], ["workflow", "Login flow"]),
        docs: docSet(["onboarding", "Repo overview"]),
        overlays: overlaySetWithMark("ts:m.ts#foo", "hotspot"),
      }),
    );
    const byId = new Map(plan.steps.map((s) => [s.id, s.status]));
    expect(byId.get("architecture-diagram")).toBe("done");
    expect(byId.get("workflow-diagram")).toBe("done");
    expect(byId.get("overview-doc")).toBe("done");
    expect(byId.get("hotspots")).toBe("done");
    expect(byId.get("flow-diagram")).toBe("todo"); // no sequence/dataflow yet
    expect(plan.done).toBe(5);
    expect(plan.complete).toBe(false);
  });

  it("completes when every starter artifact exists and offers the hand-off", () => {
    const plan = buildOnboardPlaybook(
      fresh({
        diagrams: diagramSet(
          ["architecture", "System architecture"],
          ["workflow", "Login flow"],
          ["dataflow", "Index pipeline"], // dataflow satisfies the request/data-flow step
        ),
        docs: docSet(["onboarding", "Repo overview"]),
        overlays: overlaySetWithMark("ts:m.ts#foo", "hotspot"),
      }),
    );
    expect(plan.complete).toBe(true);
    expect(plan.done).toBe(6);
    expect(plan.summary).toContain("All starter artifacts are in place.");
    expect(plan.summary).toContain("Hand off to the human");
    expect(plan.handoff).toContain("guided_tour");
  });

  it("a plain note (no mark) is enough to satisfy the hotspots step", () => {
    const plan = buildOnboardPlaybook(fresh({ overlays: overlaySetWithNote("ts:m.ts#foo", "watch this one") }));
    expect(new Map(plan.steps.map((s) => [s.id, s.status])).get("hotspots")).toBe("done");
  });

  it("points Next at the first remaining step when some authoring is done", () => {
    const plan = buildOnboardPlaybook(fresh({ diagrams: diagramSet(["architecture", "System architecture"]) }));
    expect(plan.summary).toContain("Next: Capture a primary workflow");
  });
});
