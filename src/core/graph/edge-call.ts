// FR-58 — edge call-type inspection. The raw edge vocabulary (calls / depends-on /
// contains / hands-off-to) is structural; a reader wants the *semantics*: a `calls`
// edge whose target is a class is really a construction, one to a method is a method
// call, a `depends-on` to a module is an import. This pure derivation turns an edge
// plus its endpoint into a richer, human call-type — with both an outgoing and an
// incoming phrasing so the detail panel can label either direction correctly.
//
// Kept pure (AD-1): it reads only the edge and the (already-in-memory) target node.
// No I/O, no clock. The optional `edge.call` override (closed vocabulary, structural —
// cloud-safe, so it rides the portable snapshot) lets a future indexer pin a precise
// kind; absent that, we derive what is knowable from the endpoint kinds.

import type { EdgeCallKind, GraphEdge, GraphNode } from "./types.js";

export type { EdgeCallKind };

export interface EdgeCall {
  readonly kind: EdgeCallKind;
  /** Phrasing from the source's side (outgoing): "constructs", "calls", "imports". */
  readonly label: string;
  /** Phrasing from the target's side (incoming): "constructed by", "called by". */
  readonly inverseLabel: string;
  /** One short sentence for a tooltip — no endpoint names, so it stays generic. */
  readonly description: string;
}

const CALL: Record<EdgeCallKind, EdgeCall> = {
  construct: {
    kind: "construct",
    label: "constructs",
    inverseLabel: "constructed by",
    description: "Constructs or instantiates the target class.",
  },
  "method-call": {
    kind: "method-call",
    label: "calls method",
    inverseLabel: "method called by",
    description: "Invokes a method on the target.",
  },
  call: {
    kind: "call",
    label: "calls",
    inverseLabel: "called by",
    description: "Calls the target function.",
  },
  import: {
    kind: "import",
    label: "imports",
    inverseLabel: "imported by",
    description: "Imports or depends on the target module.",
  },
  depend: {
    kind: "depend",
    label: "depends on",
    inverseLabel: "depended on by",
    description: "Depends on the target.",
  },
  contain: {
    kind: "contain",
    label: "contains",
    inverseLabel: "contained by",
    description: "Structurally contains the target (e.g. a module's members).",
  },
  handoff: {
    kind: "handoff",
    label: "hands off to",
    inverseLabel: "receives from",
    description: "Hands off to the next step in a workflow.",
  },
};

/**
 * Classify an edge into a semantic call-type. Honors an explicit `edge.call`
 * override when a (future) indexer has captured one; otherwise derives the kind
 * from the edge type and the target node's kind. `toNode` may be absent (the
 * neighbour isn't always in the local map) — derivation degrades gracefully to
 * the type-only classification.
 */
export function describeEdgeCall(edge: GraphEdge, toNode?: GraphNode): EdgeCall {
  return CALL[edgeCallKind(edge, toNode)];
}

function edgeCallKind(edge: GraphEdge, toNode?: GraphNode): EdgeCallKind {
  if (edge.call) return edge.call;
  switch (edge.type) {
    case "calls":
      if (toNode?.kind === "class") return "construct";
      if (toNode?.kind === "method") return "method-call";
      return "call";
    case "depends-on":
      return toNode?.kind === "module" ? "import" : "depend";
    case "contains":
      return "contain";
    case "hands-off-to":
      return "handoff";
  }
}
