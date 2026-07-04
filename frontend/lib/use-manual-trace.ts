"use client";

// FR-61 — the manual execution trace state, extracted from the Explorer shell so the
// shell stays under the file-size cap and this cohesive feature reads as one unit
// (mirroring use-graph-diff / use-ingest / use-agent-overlays). Owns the ordered
// route the user assembles by clicking nodes: a click splices in the shortest directed
// path to a reachable target (pure-core `extendTrace`, so every hop is edge-validated)
// and the status line narrates the last hop. A ref mirrors the route so the click /
// undo / clear handlers read the current value without re-subscribing the surfaces.
// View-only (FR-9): the trace is a sequence of node identities, never a source touch;
// playback reuses the FR-40/FR-48 replay machinery through the surface controller.

import { useCallback, useRef, useState } from "react";
import type { GraphNode, GraphEdge } from "@core/graph/types";
import { EMPTY_TRACE, extendTrace, undoTrace, type TraceState } from "@core/graph/trace";
import { findPathInEdges } from "@core/graph/path";
import type { SurfaceController } from "./surface-controller";

export interface ManualTraceController {
  /** The live ordered route (nodes list) — the trace panel renders its steps. */
  readonly trace: TraceState;
  /** The status line narrating the last hop (empty until the first click). */
  readonly traceStatus: { readonly text: string; readonly tone?: "ok" | "none" };
  /** The trail the surfaces paint: the live route while armed, a stable empty [] while
   *  disarmed (so toggling off hides it without discarding the route). */
  readonly traceSteps: readonly string[];
  /** A trace-armed click on a node — extends the route to it (Surface onTraceClick). */
  readonly onTraceClick: (address: string) => void;
  /** Drop the last hop (trace panel Undo). */
  readonly undoStep: () => void;
  /** Empty the whole route back to the prompt (trace panel Clear). */
  readonly clearTrace: () => void;
  /** Replay the route as a cinematic camera walk (trace panel Play). */
  readonly playTrace: () => void;
}

export function useManualTrace(opts: {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** A legible label for an address, for the status line narration. */
  readonly labelFor: (address: string) => string;
  /** Whether the trace tool is armed — gates whether the surfaces paint the trail. */
  readonly traceArmed: boolean;
  /** The live surface controller, for cinematic playback. */
  readonly controllerRef: React.RefObject<SurfaceController | null>;
}): ManualTraceController {
  const { nodes, edges, labelFor, traceArmed, controllerRef } = opts;

  const [trace, setTrace] = useState<TraceState>(EMPTY_TRACE);
  const traceRef = useRef<TraceState>(EMPTY_TRACE);
  const [traceStatus, setTraceStatus] = useState<{ text: string; tone?: "ok" | "none" }>({ text: "" });

  // Commit a new trace state — keep the ref + the render state in sync from one place.
  const applyTrace = useCallback((next: TraceState) => {
    traceRef.current = next;
    setTrace(next);
  }, []);

  // A click while tracing extends the manual trace. The pure-core `extendTrace` splices
  // in the shortest directed path to a reachable target (so every hop is edge-validated)
  // or records a disjoint jump otherwise; the status line narrates the last hop.
  const onTraceClick = useCallback(
    (address: string) => {
      const prev = traceRef.current;
      const next = extendTrace(prev, nodes, edges, address);
      if (next === prev) {
        setTraceStatus({ text: `${labelFor(address)} is already the trace tail` });
        return;
      }
      applyTrace(next);
      if (prev.steps.length === 0) {
        setTraceStatus({ text: `Trace started — ${labelFor(address)}` });
        return;
      }
      const tail = prev.steps[prev.steps.length - 1];
      const path = findPathInEdges(nodes, edges, tail, address);
      if (path?.found) {
        const hops = path.length === 1 ? "1 hop" : `${path.length} hops`;
        setTraceStatus({
          text: `${labelFor(tail)} → ${labelFor(address)} · ${hops} · ${next.steps.length} nodes`,
          tone: "ok",
        });
      } else {
        setTraceStatus({
          text: `${labelFor(address)} added — no path from ${labelFor(tail)}`,
          tone: "none",
        });
      }
    },
    [nodes, edges, labelFor, applyTrace],
  );

  // Trace panel actions: undo one hop, clear the whole trace, or play it back as a
  // cinematic camera walk (reuses the FR-40/FR-48 replay machinery, so the 3D camera
  // flies node-to-node along the route).
  const undoStep = useCallback(() => {
    const next = undoTrace(traceRef.current);
    applyTrace(next);
    setTraceStatus(next.steps.length ? { text: `${next.steps.length} nodes traced` } : { text: "" });
  }, [applyTrace]);
  const clearTrace = useCallback(() => {
    applyTrace(EMPTY_TRACE);
    setTraceStatus({ text: "" });
  }, [applyTrace]);
  const playTrace = useCallback(() => {
    if (traceRef.current.steps.length > 1) controllerRef.current?.replay(traceRef.current.steps);
  }, [controllerRef]);

  // The trail the surfaces paint — the live trace while armed, empty while disarmed (so
  // toggling off hides it without discarding the route, and re-arming resumes it).
  // `EMPTY_TRACE.steps` is a stable [] so the surfaces' light effect doesn't re-fire.
  const traceSteps = traceArmed ? trace.steps : EMPTY_TRACE.steps;

  return { trace, traceStatus, traceSteps, onTraceClick, undoStep, clearTrace, playTrace };
}
