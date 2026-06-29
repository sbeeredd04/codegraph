// FR-62 — the agent grounding pipeline. The user's own agent (Claude Code/Codex,
// over the codegraph MCP) authors human-legible prose for MANY nodes at once;
// this PURE module folds a whole BATCH of those groundings into the overlay set
// in one validated, immutable pass and reports what landed. It is the bulk
// counterpart to the single-anchor `upsertOverlay` (overlay.ts): same Note shape,
// same untrusted-input discipline (each body re-validated via `validateNote`),
// but addressed by node and checked against the live graph so a grounding for a
// node that isn't there is REPORTED, not silently kept.
//
// codegraph never calls an LLM (the moat): the agent does the authoring; this
// only validates, stores, and merges. The prose is agent-authored and UNTRUSTED —
// length-capped by `validateNote` here, sanitized at the render edge. Each
// grounding is anchored by node ADDRESS (graph identity, never source bytes,
// never a host path), so — like every overlay — the result is cloud-safe (AD-14)
// and read-only w.r.t. the tree (FR-9). This reuses the overlay Note channel
// rather than a parallel one, so groundings inherit overlays' already-decided
// cloud-safe carry; it is distinct from the host-local `doc` field, which is raw
// docstring lifted FROM source and so is stripped on export.
//
// PURE (AD-1): arrays/sets in, a new OverlaySet + a plain report out. No I/O, no
// clock (the writer injects each note's updatedAt), no randomness.

import type { NodeAddress } from "../graph/types.js";
import { type OverlaySet, validateNote, upsertOverlay } from "./overlay.js";

/** One agent-authored grounding for a single node: its address + a Markdown body. */
export interface NodeGrounding {
  readonly address: NodeAddress;
  /** Markdown body (agent-written, untrusted) — the node's note/docstring/summary. */
  readonly body: string;
  /** Optional ISO-8601 write time, threaded onto the stored note (the core never
   * reads a clock; the adapter that ingests the batch supplies it). */
  readonly updatedAt?: string;
}

/** Why a grounding in the batch didn't land. */
export type GroundingSkipReason = "unknown-address" | "invalid";

/** A single rejected input, with enough context for the agent to fix and retry. */
export interface GroundingSkip {
  readonly address: NodeAddress;
  readonly reason: GroundingSkipReason;
  /** The validator's message (for `invalid`), so the agent learns what to fix. */
  readonly detail?: string;
}

/** What a bulk-grounding pass did: the resulting set + a per-input accounting. */
export interface GroundingResult {
  /** The new overlay set with every valid grounding upserted. Never the input. */
  readonly set: OverlaySet;
  /** The UNIQUE node addresses now grounded by this batch (first-seen order). */
  readonly applied: readonly NodeAddress[];
  /** Each input that did not land, and why. */
  readonly skipped: readonly GroundingSkip[];
}

/**
 * Fold a batch of agent-authored node groundings into `set` as node notes. Each
 * input is (a) checked against `knownAddresses` — the addresses present in the
 * current graph snapshot — so a grounding for a stale/unknown node is reported,
 * not stored, and (b) re-validated through `validateNote` (the same untrusted
 * guard the single-note path uses: non-empty, length-capped Markdown). Valid
 * ones are upserted by node identity, so re-grounding a node replaces its note in
 * place and a later input for the same address wins.
 *
 * Returns a NEW OverlaySet (never mutates the input) plus a report of which
 * addresses landed and which were skipped and why.
 */
export function groundNodes(
  set: OverlaySet,
  groundings: readonly NodeGrounding[],
  knownAddresses: ReadonlySet<NodeAddress>,
): GroundingResult {
  let next = set;
  const appliedSet = new Set<NodeAddress>();
  const applied: NodeAddress[] = [];
  const skipped: GroundingSkip[] = [];
  for (const g of groundings) {
    const address = typeof g?.address === "string" ? g.address.trim() : "";
    if (!address || !knownAddresses.has(address)) {
      skipped.push({ address, reason: "unknown-address" });
      continue;
    }
    const r = validateNote({
      anchor: { on: "node", address },
      body: g.body,
      ...(g.updatedAt ? { updatedAt: g.updatedAt } : {}),
    });
    if (!r.ok) {
      skipped.push({ address, reason: "invalid", detail: r.error });
      continue;
    }
    next = upsertOverlay(next, r.overlay);
    if (!appliedSet.has(address)) {
      appliedSet.add(address);
      applied.push(address);
    }
  }
  return { set: next, applied, skipped };
}

/** Coverage of agent groundings over the graph: how many known nodes carry a node
 * note, and which known addresses remain ungrounded. Drives the UI's "N of M
 * grounded" indicator and a "jump to an ungrounded node" affordance. Counts only
 * notes whose anchor is a node still present in `knownAddresses`, so a note left
 * over for a deleted node neither inflates coverage nor appears as a target. */
export interface GroundingCoverage {
  readonly grounded: number;
  readonly total: number;
  /** Known addresses with no node note yet, in `knownAddresses` iteration order. */
  readonly ungrounded: readonly NodeAddress[];
}

export function groundingCoverage(
  set: OverlaySet,
  knownAddresses: ReadonlySet<NodeAddress>,
): GroundingCoverage {
  const groundedSet = new Set<NodeAddress>();
  for (const o of set.overlays) {
    if (o.kind === "note" && o.anchor.on === "node" && knownAddresses.has(o.anchor.address)) {
      groundedSet.add(o.anchor.address);
    }
  }
  const ungrounded: NodeAddress[] = [];
  for (const address of knownAddresses) if (!groundedSet.has(address)) ungrounded.push(address);
  return { grounded: groundedSet.size, total: knownAddresses.size, ungrounded };
}
