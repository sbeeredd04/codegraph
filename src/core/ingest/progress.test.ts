import { describe, it, expect } from "vitest";
import {
  IDLE_INGEST,
  INGEST_STEPS,
  ingestReducer,
  ingestView,
  type IngestState,
} from "./progress.js";

describe("ingestReducer", () => {
  it("starts idle and folds a discovering event", () => {
    const s = ingestReducer(IDLE_INGEST, { phase: "discovering", found: 42 });
    expect(s.phase).toBe("discovering");
    expect(s.found).toBe(42);
    expect(s.parsed).toBe(0);
  });

  it("keeps prior counts when an event omits a field (sparse deltas)", () => {
    let s: IngestState = ingestReducer(IDLE_INGEST, { phase: "discovering", found: 10 });
    s = ingestReducer(s, { phase: "parsing", parsed: 3, nodes: 12 });
    // `found` was not re-sent — it must survive.
    expect(s.found).toBe(10);
    expect(s.parsed).toBe(3);
    expect(s.nodes).toBe(12);
    s = ingestReducer(s, { phase: "parsing", parsed: 7, edges: 5 });
    expect(s.found).toBe(10);
    expect(s.parsed).toBe(7);
    expect(s.nodes).toBe(12); // also preserved
    expect(s.edges).toBe(5);
  });

  it("ignores invalid/negative numeric fields, keeping the prior value", () => {
    let s = ingestReducer(IDLE_INGEST, { phase: "parsing", found: 5, parsed: 2 });
    s = ingestReducer(s, { phase: "parsing", parsed: -1 as unknown as number });
    expect(s.parsed).toBe(2);
    s = ingestReducer(s, { phase: "parsing", parsed: Number.NaN });
    expect(s.parsed).toBe(2);
  });

  it("records an error message and preserves it across a stray later tick", () => {
    let s = ingestReducer(IDLE_INGEST, { phase: "parsing", found: 5, parsed: 5 });
    s = ingestReducer(s, { phase: "error", message: "Pyright crashed" });
    expect(s.phase).toBe("error");
    expect(s.error).toBe("Pyright crashed");
    // a stray non-error tick must not silently clear the failure
    s = ingestReducer(s, { phase: "resolving" });
    expect(s.error).toBe("Pyright crashed");
  });

  it("a fresh run reset to idle clears a prior error and counts", () => {
    let s = ingestReducer(IDLE_INGEST, { phase: "error", message: "boom" });
    s = ingestReducer(s, { phase: "idle" });
    expect(s.error).toBeNull();
    // folding from IDLE_INGEST again starts a clean run
    const fresh = ingestReducer(IDLE_INGEST, { phase: "discovering", found: 3 });
    expect(fresh.found).toBe(3);
    expect(fresh.error).toBeNull();
  });

  it("tracks the current file for display", () => {
    const s = ingestReducer(IDLE_INGEST, { phase: "parsing", file: "src/extension/index.ts" });
    expect(s.file).toBe("src/extension/index.ts");
  });
});

describe("ingestView", () => {
  it("idle reports inactive, not done, 0%", () => {
    const v = ingestView(IDLE_INGEST);
    expect(v.active).toBe(false);
    expect(v.done).toBe(false);
    expect(v.percent).toBe(0);
    expect(v.stepIndex).toBe(-1);
    expect(v.detail).toMatch(/not indexed/i);
  });

  it("parsing percent scales with parsed/found and is bounded", () => {
    const half = ingestView(ingestReducer(IDLE_INGEST, { phase: "parsing", found: 100, parsed: 50 }));
    expect(half.active).toBe(true);
    expect(half.percent).toBe(50); // 10 + 80*0.5
    const allParsed = ingestView(
      ingestReducer(IDLE_INGEST, { phase: "parsing", found: 100, parsed: 100 }),
    );
    expect(allParsed.percent).toBe(90); // capped below resolving
  });

  it("done is 100% and the last step", () => {
    const v = ingestView(
      ingestReducer(IDLE_INGEST, { phase: "done", found: 10, parsed: 10, nodes: 50, edges: 80 }),
    );
    expect(v.done).toBe(true);
    expect(v.percent).toBe(100);
    expect(v.stepIndex).toBe(INGEST_STEPS.length - 1);
    expect(v.detail).toContain("50 nodes");
    expect(v.detail).toContain("80 edges");
  });

  it("error surfaces the message as the label and keeps the reached progress", () => {
    const v = ingestView(
      ingestReducer(
        ingestReducer(IDLE_INGEST, { phase: "parsing", found: 10, parsed: 4 }),
        { phase: "error", message: "disk full" },
      ),
    );
    expect(v.errored).toBe(true);
    expect(v.label).toBe("disk full");
    expect(v.percent).toBe(42); // 10 + 80*0.4, where it failed
  });

  it("infers the failed step from the reached counts (not step 0) on error", () => {
    // Failed mid-parse → the stepper marks the PARSING step (1), not Discovering.
    const parsing = ingestView(
      ingestReducer(
        ingestReducer(IDLE_INGEST, { phase: "parsing", found: 50, parsed: 18 }),
        { phase: "error", message: "Pyright crashed" },
      ),
    );
    expect(parsing.stepIndex).toBe(1);
    // The detail line keeps the progress (how far it got); the reason rides `label`.
    expect(parsing.detail).toContain("18/50 files");
    expect(parsing.label).toBe("Pyright crashed");

    // Failed during discovery (no files yet) → step 0, a generic detail.
    const discover = ingestView(ingestReducer(IDLE_INGEST, { phase: "error", message: "no git" }));
    expect(discover.stepIndex).toBe(0);
    expect(discover.detail).toMatch(/indexing failed/i);

    // Failed once everything parsed (edge resolution) → the RESOLVING step (2).
    const resolving = ingestView(
      ingestReducer(
        ingestReducer(IDLE_INGEST, { phase: "resolving", found: 8, parsed: 8 }),
        { phase: "error", message: "ts-morph oom" },
      ),
    );
    expect(resolving.stepIndex).toBe(2);
  });

  it("surfaces a skipped-files count in the detail line", () => {
    const v = ingestView(
      ingestReducer(IDLE_INGEST, { phase: "done", found: 10, parsed: 9, failed: 1, nodes: 5, edges: 3 }),
    );
    expect(v.detail).toMatch(/1 skipped/);
  });
});
