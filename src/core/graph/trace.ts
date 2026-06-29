import type { GraphEdge, NodeAddress } from "./types.js";
import {
  findPathInEdges,
  pathEdgeKey,
  type PathHighlight,
  type PathNodeRef,
} from "./path.js";

// Manual execution trace (FR-61): the ordered sequence of nodes a user assembles
// by clicking the board, building a route through the graph one hop at a time —
// the codegraph analogue of stepping a debugger, or replaying a log onto the map.
// Pure data (AD-1): no rendering, no host concerns, so both render surfaces and
// the trace panel read the SAME model and it is fully vitest-tested in isolation.
// Reuses `findPathInEdges` so every extension stays edge-validated: clicking a
// reachable node splices in the shortest directed dependency path between the
// trace's tail and the target, making the intermediate hops explicit. Unifies the
// old two-click "Trace" toggle (PM-backlog #3) into a click-to-extend trail.

export interface TraceState {
  /** The FLATTENED ordered node sequence — both clicked nodes and the path hops
   * spliced between them. Empty before the first click. */
  readonly steps: readonly NodeAddress[];
}

/** The empty trace — nothing clicked yet. */
export const EMPTY_TRACE: TraceState = { steps: [] };

/**
 * Extend a trace by clicking `address`:
 *  - empty trace → the trace starts at `address`;
 *  - clicking the current tail again → unchanged (idempotent; returns the same
 *    object so callers can cheaply detect a no-op);
 *  - `address` reachable from the tail → splice in the shortest directed path
 *    (tail-exclusive), so every appended hop is a real edge;
 *  - otherwise (unknown endpoint or no directed route) → append `address` alone
 *    as a deliberate disjoint jump (logs and traces do leap non-adjacent nodes).
 * Pure: returns a new state, never mutates the input.
 */
export function extendTrace(
  state: TraceState,
  nodes: readonly PathNodeRef[],
  edges: readonly GraphEdge[],
  address: NodeAddress,
): TraceState {
  if (state.steps.length === 0) return { steps: [address] };
  const tail = state.steps[state.steps.length - 1];
  if (tail === address) return state;
  const path = findPathInEdges(nodes, edges, tail, address);
  if (path?.found && path.nodes.length > 1) {
    // path.nodes[0] === tail (already present) — append the rest in order.
    return { steps: [...state.steps, ...path.nodes.slice(1)] };
  }
  return { steps: [...state.steps, address] };
}

/** Drop the last node from the trace (undo one hop). Empty stays empty, returned
 * as the same object so a no-op is cheap to detect. */
export function undoTrace(state: TraceState): TraceState {
  if (state.steps.length === 0) return state;
  return { steps: state.steps.slice(0, -1) };
}

/** Reset to the empty trace. */
export function clearTrace(): TraceState {
  return EMPTY_TRACE;
}

/**
 * The node/edge sets a surface paints to show the trail: every step node leads,
 * and each consecutive pair contributes a directed edge key so the real wiring
 * between hops lights up (a disjoint jump simply matches no edge). Mirrors
 * `pathHighlight`'s shape so the render lens treats a trace and a path alike.
 */
export function traceHighlight(state: TraceState): PathHighlight {
  const edges = new Set<string>();
  for (let i = 1; i < state.steps.length; i += 1) {
    edges.add(pathEdgeKey(state.steps[i - 1], state.steps[i]));
  }
  return { nodes: new Set(state.steps), edges };
}
