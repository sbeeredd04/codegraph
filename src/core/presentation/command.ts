// FR-39 (Epic 19): the presentation command — an EPHEMERAL directive the user's
// connected agent issues (through the codegraph MCP and the host) to DRIVE the
// live board, "like Playwright for the codegraph surface". It is the imperative
// twin of the persistent overlay (FR-37): an overlay is a saved annotation ABOUT
// the code; a command is a live "do this to the view now" — highlight a set,
// trace a path, move the camera, switch projection, open a panel, toggle a lens.
//
// Both are addressed purely by graph identity (+ view directives) and carry NO
// source bytes and NO absolute host path, so they are cloud-safe (AD-14) and
// never mutate source (FR-9). Commands are NEVER serialized into GraphSnapshot —
// they ride the live host↔webview message, exactly like editorRoot (transport-
// only), so a portable artifact never persists a transient view directive.
//
// This module is pure: the discriminated union + a tolerant validate codec shared
// by the host (emit) and the webview (dispatch). The agent authoring these is
// UNTRUSTED, so every field is validated and every address set is length-capped.

import type { ProjectionKind } from "../graph/projection.js";

export const PRESENTATION_COMMAND_VERSION = 1 as const;

/** The transient-highlight palette, shared with the frontend surface controller
 * (FR-43) so the command vocabulary and the renderer agree by construction.
 * `peek` (FR-71) is the user's "what's this wired to" connections spotlight —
 * ctrl/⌘-clicking a node, or locating it from its open source — distinct in hue
 * from selection so a peek never reads as a pick. */
export const HIGHLIGHT_STYLES = ["accent", "trace", "warn", "peek"] as const;
export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number];

/** Panels the agent can open or close on the board. */
export const PANEL_KINDS = ["diagrams", "docs", "ask", "detail"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** Toggleable view affordances (the 2D lenses). */
export const AFFORDANCE_KINDS = ["orphans", "folders", "trace"] as const;
export type AffordanceKind = (typeof AFFORDANCE_KINDS)[number];

/** Projections an agent may switch to (mirrors core ProjectionKind). */
export const PROJECTION_KINDS = ["full", "dependency", "call", "structure"] as const;

// Untrusted-input guards. A real command is far under these; the caps exist so a
// misbehaving or adversarial driver cannot flood the surface.
const MAX_ADDRESSES = 500;
const MAX_ADDRESS_LEN = 1_000;

export interface HighlightNodesCommand {
  readonly kind: "highlight_nodes";
  readonly addresses: readonly string[];
  readonly style?: HighlightStyle;
}
export interface HighlightPathCommand {
  readonly kind: "highlight_path";
  readonly from: string;
  readonly to: string;
}
export interface FocusCameraCommand {
  readonly kind: "focus_camera";
  readonly addresses: readonly string[];
  /** true (default) selects the set's head + frames it; false only moves the camera. */
  readonly select?: boolean;
}
export interface SetProjectionCommand {
  readonly kind: "set_projection";
  readonly projection: ProjectionKind;
}
export interface OpenPanelCommand {
  readonly kind: "open_panel";
  readonly panel: PanelKind;
  /** true (default) opens, false closes. */
  readonly open?: boolean;
}
export interface ToggleAffordanceCommand {
  readonly kind: "toggle_affordance";
  readonly affordance: AffordanceKind;
  /** explicit desired state (idempotent); omitted = flip. */
  readonly on?: boolean;
}
export interface ReplayCommand {
  readonly kind: "replay";
  /** the ordered tour stops — the surface lights them cumulatively, one per dwell. */
  readonly addresses: readonly string[];
  /** per-step dwell in ms; clamped + defaulted by the pure sequencer (replay.ts). */
  readonly dwellMs?: number;
}
/**
 * Open a node in the user's REAL editor (FR-78): the "point the human at code"
 * verb. Addressed purely by graph identity — the HOST resolves the address to its
 * repo-relative file:line and reveals it (showTextDocument) with the same
 * resolve-within-root guard as FR-31, so no source byte and no absolute path ride
 * the command (AD-14/AD-16). Unlike the other commands this one drives the EDITOR,
 * not the webview: the host intercepts it and never forwards it to the board.
 */
export interface RevealCommand {
  readonly kind: "reveal";
  readonly address: string;
}

export type PresentationCommand =
  | HighlightNodesCommand
  | HighlightPathCommand
  | FocusCameraCommand
  | SetProjectionCommand
  | OpenPanelCommand
  | ToggleAffordanceCommand
  | ReplayCommand
  | RevealCommand;

export const PRESENTATION_COMMAND_KINDS = [
  "highlight_nodes",
  "highlight_path",
  "focus_camera",
  "set_projection",
  "open_panel",
  "toggle_affordance",
  "replay",
  "reveal",
] as const;

/**
 * Output port: where a driving tool EMITS an ephemeral presentation command
 * (FR-39 slice B). The MCP adapter implements it — in the standalone server the
 * implementation is a host-local transient queue that the live ExplorerPanel
 * drains and forwards to its webview. Declared here (core declares ports,
 * adapters implement them) so the tool layer stays I/O-free and testable (AD-1).
 * A command is a live view directive, NEVER persisted into a GraphSnapshot.
 */
export interface PresentationCommandSink {
  emit(command: PresentationCommand): void | Promise<void>;
}

function isAddress(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ADDRESS_LEN;
}

/** A non-empty, length-capped, all-string address array — or null if malformed. */
function validAddresses(v: unknown): readonly string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ADDRESSES) return null;
  const out: string[] = [];
  for (const a of v) {
    if (!isAddress(a)) return null;
    out.push(a);
  }
  return out;
}

function inSet(v: unknown, set: readonly string[]): boolean {
  return typeof v === "string" && set.includes(v);
}

/**
 * Validate an untrusted inbound value into a PresentationCommand, or null if it
 * is malformed / unknown. Tolerant by design — a bad command is dropped, never
 * thrown, so one stray directive can't break the driving session. Shared by the
 * host (before posting) and the webview (before dispatching).
 */
export function validatePresentationCommand(raw: unknown): PresentationCommand | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "highlight_nodes": {
      const addresses = validAddresses(r.addresses);
      if (!addresses) return null;
      if (r.style !== undefined && !inSet(r.style, HIGHLIGHT_STYLES)) return null;
      const style = r.style as HighlightStyle | undefined;
      return { kind: "highlight_nodes", addresses, ...(style ? { style } : {}) };
    }
    case "highlight_path": {
      if (!isAddress(r.from) || !isAddress(r.to)) return null;
      return { kind: "highlight_path", from: r.from, to: r.to };
    }
    case "focus_camera": {
      const addresses = validAddresses(r.addresses);
      if (!addresses) return null;
      if (r.select !== undefined && typeof r.select !== "boolean") return null;
      return {
        kind: "focus_camera",
        addresses,
        ...(typeof r.select === "boolean" ? { select: r.select } : {}),
      };
    }
    case "set_projection": {
      if (!inSet(r.projection, PROJECTION_KINDS)) return null;
      return { kind: "set_projection", projection: r.projection as ProjectionKind };
    }
    case "open_panel": {
      if (!inSet(r.panel, PANEL_KINDS)) return null;
      if (r.open !== undefined && typeof r.open !== "boolean") return null;
      return {
        kind: "open_panel",
        panel: r.panel as PanelKind,
        ...(typeof r.open === "boolean" ? { open: r.open } : {}),
      };
    }
    case "toggle_affordance": {
      if (!inSet(r.affordance, AFFORDANCE_KINDS)) return null;
      if (r.on !== undefined && typeof r.on !== "boolean") return null;
      return {
        kind: "toggle_affordance",
        affordance: r.affordance as AffordanceKind,
        ...(typeof r.on === "boolean" ? { on: r.on } : {}),
      };
    }
    case "replay": {
      const addresses = validAddresses(r.addresses);
      if (!addresses) return null;
      // dwellMs is advisory — the sequencer clamps the value; here we only reject
      // a non-finite number so a NaN/Infinity can't reach the renderer's timers.
      if (r.dwellMs !== undefined && (typeof r.dwellMs !== "number" || !Number.isFinite(r.dwellMs))) {
        return null;
      }
      return {
        kind: "replay",
        addresses,
        ...(typeof r.dwellMs === "number" ? { dwellMs: r.dwellMs } : {}),
      };
    }
    case "reveal": {
      if (!isAddress(r.address)) return null;
      return { kind: "reveal", address: r.address };
    }
    default:
      return null;
  }
}
