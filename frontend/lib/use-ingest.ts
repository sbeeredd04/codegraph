"use client";

// FR-55 — live repo-ingestion state for the Explorer shell. Owns the folded scan
// state (via the pure core `ingestReducer`), subscribes to the host's progress
// stream, drives the user "Index" trigger, and installs the dev-only `__ingest`
// hook the e2e drives. The web plane has no host to scan (AD-14), so off the
// webview the only driver is that dev hook — exactly like __diff / __sigma.
//
// View-only (FR-9): indexing reads the repo to (re)build the graph, never writes.
// A tick carries counts + a repo-relative current file only — never source bytes
// or an absolute host path (AD-16 / AD-14).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IDLE_INGEST,
  ingestReducer,
  ingestView,
  type IngestEvent,
  type IngestState,
  type IngestView,
} from "@core/ingest/progress";
import { requestIndex as postIndexRequest, subscribeToIngest } from "./webview-bridge";

export interface IngestController {
  readonly state: IngestState;
  /** Render-ready projection (phase/stepper/percent/detail). */
  readonly view: IngestView;
  /** The live-progress card should be shown (a run is active, just finished, or errored). */
  readonly visible: boolean;
  /** Ask the host to (re)index the workspace; optimistically shows the card. */
  readonly index: () => void;
  /** Hide a settled (done/error) card. A new run re-shows it. */
  readonly dismiss: () => void;
}

const TERMINAL = new Set<IngestState["phase"]>(["done", "error"]);

export function useIngest(rootRef: React.RefObject<HTMLElement | null>): IngestController {
  const [state, setState] = useState<IngestState>(IDLE_INGEST);
  const [dismissed, setDismissed] = useState(false);

  // Fold one tick. A `discovering` tick arriving from a terminal/idle state starts
  // a FRESH run (reset first) so stale counts don't carry; mid-run ticks fold
  // normally (sparse deltas preserve prior fields). Any tick clears a dismissal —
  // there's new activity worth showing.
  const push = useCallback((event: IngestEvent) => {
    setDismissed(false);
    setState((prev) => {
      const base =
        event.phase === "discovering" && (TERMINAL.has(prev.phase) || prev.phase === "idle")
          ? IDLE_INGEST
          : prev;
      return ingestReducer(base, event);
    });
  }, []);

  const index = useCallback(() => {
    // Optimistic: show the card the instant the user clicks, before the host's
    // first tick lands (off the webview that tick never comes — the dev hook drives).
    push({ phase: "discovering" });
    postIndexRequest();
  }, [push]);

  const dismiss = useCallback(() => setDismissed(true), []);

  // Live host stream (only fires inside the VS Code webview).
  useEffect(() => subscribeToIngest(push), [push]);

  // E2E hook (dev only — tree-shaken from the static export like __diff / __sigma).
  // Lets a test push synthetic ticks so the live-progress UI is driven
  // deterministically without a webview host or a real scan.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const el = rootRef.current as (HTMLElement & { __ingest?: unknown }) | null;
    if (!el) return;
    el.__ingest = {
      push: (event: IngestEvent): void => push(event),
      reset: (): void => {
        setState(IDLE_INGEST);
        setDismissed(false);
      },
    };
    return () => {
      delete (el as { __ingest?: unknown }).__ingest;
    };
  }, [push, rootRef]);

  const view = useMemo(() => ingestView(state), [state]);
  const visible = state.phase !== "idle" && !dismissed;

  return { state, view, visible, index, dismiss };
}
