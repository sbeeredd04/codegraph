"use client";

// FR-69 — the live graph-diff lens state, extracted from the Explorer shell so the
// shell stays under the file-size cap. Owns the armed flag + the captured baseline
// snapshot, recomputes the structural delta (lib/graph-diff) only while armed with a
// baseline, and installs the dev-only `__diff` hook the e2e drives. View-only (FR-9):
// capturing a baseline copies the in-memory graph identities, never the source.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  computeGraphDiff,
  type GraphSnapshotInput,
  type GraphDiffResult,
} from "./graph-diff";
import { sampleBaseline } from "./sample-diff";

export interface GraphDiffController {
  /** Diff lens armed (toolbar toggle). */
  readonly diffMode: boolean;
  readonly toggleDiff: () => void;
  readonly setDiffMode: (on: boolean) => void;
  /** A baseline has been captured to compare the live graph against. */
  readonly hasBaseline: boolean;
  /** Pin the current graph as the baseline (the panel's "Set baseline"). */
  readonly captureBaseline: () => void;
  /** Pin a realistic synthetic "previous version" of the current graph so the lens
   * shows a believable delta where there's no live re-index channel (web plane). */
  readonly applySampleBaseline: () => void;
  /** Drop the baseline back to the empty state. */
  readonly clearBaseline: () => void;
  /** The computed delta (tint map + counts + ranked feed), or null when not armed
   * or no baseline is captured yet. */
  readonly result: GraphDiffResult | null;
}

export function useGraphDiff(
  nodes: GraphSnapshotInput["nodes"],
  edges: GraphSnapshotInput["edges"],
  rootRef: React.RefObject<HTMLElement | null>,
): GraphDiffController {
  const [diffMode, setDiffModeState] = useState(false);
  const [baseline, setBaseline] = useState<GraphSnapshotInput | null>(null);

  const result = useMemo(
    () => (diffMode && baseline ? computeGraphDiff(baseline, { nodes, edges }) : null),
    [diffMode, baseline, nodes, edges],
  );

  const toggleDiff = useCallback(() => setDiffModeState((v) => !v), []);
  const setDiffMode = useCallback((on: boolean) => setDiffModeState(on), []);
  const captureBaseline = useCallback(() => setBaseline({ nodes, edges }), [nodes, edges]);
  // Arm the lens against a fabricated earlier snapshot of THIS graph (sample-diff),
  // so the web plane (no live channel) can show a real added/removed/changed/moved mix
  // instead of the meaningless all-added diff you get by switching to another dataset.
  const applySampleBaseline = useCallback(() => {
    setDiffModeState(true);
    setBaseline(sampleBaseline({ nodes, edges }));
  }, [nodes, edges]);
  const clearBaseline = useCallback(() => setBaseline(null), []);

  // E2E hook (dev only — `process.env.NODE_ENV` is statically "production" in the
  // static export, so this is tree-shaken from shipped builds like the 2D __sigma /
  // 3D __overlay3d hooks). Lets a test read the live snapshot and inject a crafted
  // baseline, so the diff lens is driven deterministically without a second live
  // snapshot — the web plane has no live channel (subscribeToSnapshot only fires
  // inside the VS Code webview), so this is the only way to differ the two graphs.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const el = rootRef.current as (HTMLElement & { __diff?: unknown }) | null;
    if (!el) return;
    el.__diff = {
      snapshot: (): GraphSnapshotInput => ({ nodes, edges }),
      setBaseline: (b: GraphSnapshotInput): void => setBaseline(b),
      clearBaseline: (): void => setBaseline(null),
    };
    return () => {
      delete (el as { __diff?: unknown }).__diff;
    };
  }, [nodes, edges, rootRef]);

  return {
    diffMode,
    toggleDiff,
    setDiffMode,
    hasBaseline: baseline != null,
    captureBaseline,
    applySampleBaseline,
    clearBaseline,
    result,
  };
}
