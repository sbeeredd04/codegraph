// Canonical Node/Edge schema (spine AD-4) with pinned field semantics (AD-10).
// This shape IS the contract between the core and every adapter. No local extension.

/** Closed vocabulary (AD-10). */
export type NodeKind = "module" | "class" | "function" | "method" | "workflow";

/** Semantic relationships (AD-4). `overrides` (FR-97): a subclass method overrides the
 * same-named base-class method it inherits (`HTTPAdapter.send` → `BaseAdapter.send`).
 * Structural — derived from class/method names, no source bytes — so cloud-safe like
 * `contains`. It closes the virtual-dispatch gap: a call statically resolves to the
 * abstract base method, and this edge names the concrete override reached at runtime. */
export type EdgeType = "calls" | "depends-on" | "contains" | "hands-off-to" | "overrides";

/** Closed vocabulary for an edge's precise call classification (FR-58). The
 * human labels + the from-endpoint derivation live in `edge-call.ts`. */
export type EdgeCallKind =
  | "construct"
  | "method-call"
  | "call"
  | "import"
  | "depend"
  | "contain"
  | "handoff"
  // FR-97: the semantic kind of an `overrides` edge — a subclass method overriding the
  // base-class method it inherits. Structural (class/method names), so cloud-safe.
  | "override"
  // FR-84: a `calls` edge that is a JSX render (`<Card/>` → the Card component). JSX
  // compiles to a `React.createElement(Card)` call, so it stays a `calls` edge; this
  // sub-kind just lets the surface say "renders" instead of "calls". Structural, so
  // cloud-safe like the rest of the vocabulary.
  | "render";

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
  /**
   * Representative input/output examples for the node (FR-59), e.g.
   * `"add(2, 3) → 5"` — sample call values captured host-side from source or a
   * runtime trace. HOST-LOCAL like `doc`: these can embed literal source/runtime
   * VALUES, so `exportGraphSnapshot` strips them and they never reach the
   * source-blind cloud plane (AD-14). The signature-derived param/return SHAPE
   * (see `signature.ts`) is structural and stays in the snapshot; only these
   * concrete value examples are host-local.
   */
  readonly examples?: readonly string[];
  /**
   * Leading decorators on the declaration (FR-85), captured AD-14-safe — the callee
   * dotted-name + literal args only (e.g. `"app.get('/users')"`, `"property"`,
   * `"dataclass"`). STRUCTURAL API surface, not source bytes: a route decorator is the
   * app's public shape, like a `signature` type, so — unlike host-local `doc` — it
   * rides the portable snapshot and reaches the cloud plane. Makes routes/handlers
   * legible (endpoint discovery). Present only when the declaration is decorated.
   */
  readonly decorators?: readonly string[];
}

export interface GraphEdge {
  readonly from: NodeAddress;
  readonly to: NodeAddress;
  readonly type: EdgeType;
  /**
   * Optional, precise call classification captured by the indexer (FR-58), e.g.
   * `"construct"` for a `calls` edge into a class. A closed-vocabulary structural
   * tag (NOT source bytes), so — unlike the host-local `doc` — it is cloud-safe
   * and rides the portable snapshot. When absent, `describeEdgeCall` derives the
   * kind from the edge type and the target node's kind.
   */
  readonly call?: EdgeCallKind;
}

/** The one delta type all consumers receive (AD-6). */
export interface GraphDelta {
  readonly added: readonly GraphNode[];
  readonly removed: readonly NodeAddress[];
  readonly changed: readonly { address: NodeAddress; before: GraphNode; after: GraphNode }[];
  readonly movedRenamed: readonly { address: NodeAddress; from: NodeAddress; to: NodeAddress }[];
}
