// Knowledge overlays (Epic 19 / FR-37): the agent's durable annotations ON the
// graph — the persistent half of "agent-as-co-pilot". Three kinds layer over the
// structural graph + diagrams + docs:
//   - note:  free-form Markdown pinned to a NODE or an EDGE ("what happened & how").
//   - mark:  a typed badge on a node (bug | breakpoint | issue | todo | hotspot),
//            with an optional severity and short label.
//   - group: a labelled, ad-hoc set of node addresses (a feature the agent named).
//
// Overlays are anchored by GRAPH IDENTITY (a node address, an edge triple, or an
// address set), so they are prose/metadata ABOUT code, never source bytes — which
// makes them cloud-safe (AD-14) and read-only w.r.t. the tree (FR-9). The agent's
// text is UNTRUSTED: length-capped here, sanitized at the render edge.
//
// This module is PURE (AD-1): types, validation, immutable set updates, a Store
// port, and a snapshot-carry helper. No I/O, no clock (the writer injects
// updatedAt), no randomness (ids are content/identity-derived).
//
// Move-resilience: anchors use the node's address, the move-stable identity the
// GraphDelta diff already matches across renames (commit 66c9235). Re-anchoring an
// overlay set across a diff's moved map is a thin follow-on; the fnv1a id keeps
// each overlay compact and deterministic in the meantime — same anchor, same id.

import type { NodeAddress, EdgeType } from "../graph/types.js";

export const OVERLAY_SET_VERSION = 1 as const;

// Untrusted-input guards. Real overlays sit well under these; the caps stop a
// misbehaving or adversarial writer from bloating the cache.
const MAX_BODY = 10_000; // a note's Markdown
const MAX_LABEL = 200; // a group label / mark label
const MAX_MEMBERS = 1_000; // a group's member list

export const MARK_KINDS = ["bug", "breakpoint", "issue", "todo", "hotspot"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export const MARK_SEVERITIES = ["info", "warn", "error"] as const;
export type MarkSeverity = (typeof MARK_SEVERITIES)[number];

const EDGE_TYPES: ReadonlySet<string> = new Set<EdgeType>([
  "calls",
  "depends-on",
  "contains",
  "hands-off-to",
]);

/** What an overlay attaches to: a node, or a directed edge between two nodes. */
export type OverlayAnchor =
  | { readonly on: "node"; readonly address: NodeAddress }
  | { readonly on: "edge"; readonly from: NodeAddress; readonly to: NodeAddress; readonly type: EdgeType };

/** Free-form Markdown pinned to a node or an edge. One note per anchor (re-saving
 * replaces it, like a node's enrichment) — put multiple thoughts in one body. */
export interface Note {
  readonly id: string;
  readonly kind: "note";
  readonly anchor: OverlayAnchor;
  /** Markdown body (agent-written, untrusted). */
  readonly body: string;
  readonly updatedAt?: string;
}

/** A typed badge on a node. One mark per (node, kind) — re-marking updates it. */
export interface Mark {
  readonly id: string;
  readonly kind: "mark";
  readonly address: NodeAddress;
  readonly mark: MarkKind;
  readonly severity?: MarkSeverity;
  /** Optional one-line label (agent-written, untrusted). */
  readonly label?: string;
  readonly updatedAt?: string;
}

/** A labelled, ad-hoc set of node addresses — a feature/region the agent named. */
export interface Group {
  readonly id: string;
  readonly kind: "group";
  /** Display label (agent-written, untrusted); also its identity. */
  readonly label: string;
  readonly members: readonly NodeAddress[];
  readonly updatedAt?: string;
}

export type Overlay = Note | Mark | Group;

export interface OverlaySet {
  readonly version: number;
  readonly overlays: readonly Overlay[];
}

export type ValidateOverlayResult =
  | { readonly ok: true; readonly overlay: Overlay }
  | { readonly ok: false; readonly error: string };

export type ParseOverlaySetResult =
  | { readonly ok: true; readonly set: OverlaySet }
  | { readonly ok: false; readonly error: string };

// FNV-1a (32-bit) → 8-char hex. Pure + deterministic; used only to keep ids
// compact (a collision merely shares an id between two identical-by-construction
// anchors, which is harmless). Mirrors the enrichment cache's addressing.
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A stable string for an anchor — node by address, edge by its directed triple. */
function anchorKey(anchor: OverlayAnchor): string {
  return anchor.on === "node"
    ? `n:${anchor.address}`
    : `e:${anchor.from}>${anchor.to}:${anchor.type}`;
}

/** Deterministic ids: same anchor/kind → same id, so a re-save upserts in place. */
export function noteId(anchor: OverlayAnchor): string {
  return `note/${fnv1a(anchorKey(anchor))}`;
}
export function markId(address: NodeAddress, mark: MarkKind): string {
  return `mark/${mark}/${fnv1a(`n:${address}`)}`;
}
export function groupId(label: string): string {
  return `group/${fnv1a(label.trim().toLowerCase())}`;
}

/** Validate an untrusted anchor into a clean {@link OverlayAnchor}, or null. */
function cleanAnchor(raw: unknown): OverlayAnchor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.on === "node") {
    const address = asString(o.address).trim();
    return address ? { on: "node", address } : null;
  }
  if (o.on === "edge") {
    const from = asString(o.from).trim();
    const to = asString(o.to).trim();
    const type = asString(o.type).trim();
    if (!from || !to || !EDGE_TYPES.has(type)) return null;
    return { on: "edge", from, to, type: type as EdgeType };
  }
  return null;
}

const optTimestamp = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Validate untrusted note input (from a write tool or a hand-edited cache). */
export function validateNote(input: {
  anchor?: unknown;
  body?: unknown;
  updatedAt?: unknown;
}): ValidateOverlayResult {
  const anchor = cleanAnchor(input.anchor);
  if (!anchor) return { ok: false, error: "A note needs an anchor: a node address or an edge triple." };
  if (typeof input.body !== "string") return { ok: false, error: "A note needs a Markdown body (a string)." };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "The note body is empty." };
  if (body.length > MAX_BODY) return { ok: false, error: `Note body exceeds ${MAX_BODY} characters.` };
  const updatedAt = optTimestamp(input.updatedAt);
  return {
    ok: true,
    overlay: { id: noteId(anchor), kind: "note", anchor, body, ...(updatedAt ? { updatedAt } : {}) },
  };
}

/** Validate untrusted mark input. */
export function validateMark(input: {
  address?: unknown;
  mark?: unknown;
  severity?: unknown;
  label?: unknown;
  updatedAt?: unknown;
}): ValidateOverlayResult {
  const address = asString(input.address).trim();
  if (!address) return { ok: false, error: "A mark needs a node address." };
  const mark = asString(input.mark).trim() as MarkKind;
  if (!MARK_KINDS.includes(mark)) {
    return { ok: false, error: `Unknown mark kind. Use one of: ${MARK_KINDS.join(", ")}.` };
  }
  const severityRaw = asString(input.severity).trim() as MarkSeverity;
  const severity = MARK_SEVERITIES.includes(severityRaw) ? severityRaw : undefined;
  const labelRaw = asString(input.label).trim();
  const label = labelRaw ? labelRaw.slice(0, MAX_LABEL) : undefined;
  const updatedAt = optTimestamp(input.updatedAt);
  return {
    ok: true,
    overlay: {
      id: markId(address, mark),
      kind: "mark",
      address,
      mark,
      ...(severity ? { severity } : {}),
      ...(label ? { label } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    },
  };
}

/** Validate untrusted group input. */
export function validateGroup(input: {
  label?: unknown;
  members?: unknown;
  updatedAt?: unknown;
}): ValidateOverlayResult {
  const label = asString(input.label).trim();
  if (!label) return { ok: false, error: "A group needs a label." };
  if (label.length > MAX_LABEL) return { ok: false, error: `Group label exceeds ${MAX_LABEL} characters.` };
  if (!Array.isArray(input.members)) return { ok: false, error: "A group needs a members array." };
  const members = input.members
    .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    .map((m) => m.trim())
    .slice(0, MAX_MEMBERS);
  if (!members.length) return { ok: false, error: "A group needs at least one member node address." };
  const updatedAt = optTimestamp(input.updatedAt);
  return {
    ok: true,
    overlay: { id: groupId(label), kind: "group", label, members, ...(updatedAt ? { updatedAt } : {}) },
  };
}

/** Validate an untrusted overlay of any kind (the parse/load path). Dispatches on
 * `kind`; an unknown or malformed shape is rejected (never throws). */
export function validateOverlay(input: unknown): ValidateOverlayResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "An overlay must be an object." };
  }
  const o = input as Record<string, unknown>;
  switch (o.kind) {
    case "note":
      return validateNote(o);
    case "mark":
      return validateMark(o);
    case "group":
      return validateGroup(o);
    default:
      return { ok: false, error: `Unknown overlay kind "${String(o.kind)}".` };
  }
}

/** An empty, versioned set — the starting point for a repo with no overlays. */
export function emptyOverlaySet(): OverlaySet {
  return { version: OVERLAY_SET_VERSION, overlays: [] };
}

/** Insert `overlay`, replacing any existing one with the same id in place. Immutable. */
export function upsertOverlay(set: OverlaySet, overlay: Overlay): OverlaySet {
  const idx = set.overlays.findIndex((o) => o.id === overlay.id);
  const overlays =
    idx === -1 ? [...set.overlays, overlay] : set.overlays.map((o, i) => (i === idx ? overlay : o));
  return { version: set.version, overlays };
}

/** Remove the overlay with `id` (no-op if absent). Immutable. */
export function removeOverlay(set: OverlaySet, id: string): OverlaySet {
  return { version: set.version, overlays: set.overlays.filter((o) => o.id !== id) };
}

/**
 * Parse a serialized {@link OverlaySet}, tolerating a partly-corrupt or
 * hand-edited file: malformed individual overlays are dropped (re-validated via
 * {@link validateOverlay}) rather than failing the whole load. Never throws.
 */
export function parseOverlaySet(text: string): ParseOverlaySetResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Expected an overlay-set object." };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.overlays)) {
    return { ok: false, error: "Expected an `overlays` array." };
  }
  const overlays: Overlay[] = [];
  for (const entry of obj.overlays) {
    const r = validateOverlay(entry);
    if (r.ok) overlays.push(r.overlay);
  }
  const version = typeof obj.version === "number" ? obj.version : OVERLAY_SET_VERSION;
  return { ok: true, set: { version, overlays } };
}

/**
 * Outbound port for persisting a repo's overlay set (Epic 19). The MCP write tools
 * and the board talk to this; a disk-backed adapter implements it. Interface only —
 * no I/O here (AD-1).
 */
export interface OverlayStore {
  /** Every overlay saved for the repo. */
  all(): Promise<OverlaySet>;
  /** Insert or replace an overlay (by its id). */
  save(overlay: Overlay): Promise<void>;
  /** Remove an overlay by id; resolves false if it was not present. */
  remove(id: string): Promise<boolean>;
}

/** Everything attached to one node: its note (if any), its marks, and the groups
 * it belongs to. The board uses this to render a node's overlay affordances. */
export function nodeOverlays(
  set: OverlaySet,
  address: NodeAddress,
): { note?: Note; marks: Mark[]; groups: Group[] } {
  let note: Note | undefined;
  const marks: Mark[] = [];
  const groups: Group[] = [];
  for (const o of set.overlays) {
    if (o.kind === "note" && o.anchor.on === "node" && o.anchor.address === address) note = o;
    else if (o.kind === "mark" && o.address === address) marks.push(o);
    else if (o.kind === "group" && o.members.includes(address)) groups.push(o);
  }
  return { note, marks, groups };
}

/** Split a set into its three kinds — a convenience for renderers/serializers. */
export function overlaysByKind(set: OverlaySet): { notes: Note[]; marks: Mark[]; groups: Group[] } {
  const notes: Note[] = [];
  const marks: Mark[] = [];
  const groups: Group[] = [];
  for (const o of set.overlays) {
    if (o.kind === "note") notes.push(o);
    else if (o.kind === "mark") marks.push(o);
    else groups.push(o);
  }
  return { notes, marks, groups };
}
