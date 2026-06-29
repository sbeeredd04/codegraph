// Canonical Node/Edge schema (spine AD-4) with pinned field semantics (AD-10).
// This shape IS the contract between the core and every adapter. No local extension.

/** Closed vocabulary (AD-10). */
export type NodeKind = "module" | "class" | "function" | "method" | "workflow";

/** Semantic relationships (AD-4). */
export type EdgeType = "calls" | "depends-on" | "contains" | "hands-off-to";

/** Stable string address for a node, e.g. `ts:src/auth.ts#login`. Overload-disambiguated (AD-10). */
export type NodeAddress = string;

/** 0-based line/character in UTF-16 code units (AD-10). Adapters convert at their boundary. */
export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly character: number;
}

export interface GraphNode {
  readonly address: NodeAddress;
  readonly kind: NodeKind;
  readonly name: string;
  readonly location: SourceLocation;
  readonly signature?: string;
  /**
   * The node's leading doc-comment (JSDoc / Python docstring / leading line
   * comment), captured host-side by the indexer for the FR-60 docstring-fallback
   * note. HOST-LOCAL: this is developer prose lifted from source, so — like the
   * editor root (AD-14) — `exportGraphSnapshot` strips it and it never rides the
   * portable snapshot that reaches the source-blind cloud plane. It travels only
   * on the live local-plane message (webview / `codegraph serve`).
   */
  readonly doc?: string;
}

export interface GraphEdge {
  readonly from: NodeAddress;
  readonly to: NodeAddress;
  readonly type: EdgeType;
}

/** The one delta type all consumers receive (AD-6). */
export interface GraphDelta {
  readonly added: readonly GraphNode[];
  readonly removed: readonly NodeAddress[];
  readonly changed: readonly { address: NodeAddress; before: GraphNode; after: GraphNode }[];
  readonly movedRenamed: readonly { address: NodeAddress; from: NodeAddress; to: NodeAddress }[];
}
