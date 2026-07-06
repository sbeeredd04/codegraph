// Epic 7.4 — the host side of the webview↔export message contract. Mirrors
// frontend/lib/webview-bridge.ts: the Next export posts `codegraph:ready` once it
// mounts, and the host replies with `codegraph:snapshot` carrying the live graph.
//
// Pure (no vscode, no fs) so the contract is unit-testable in isolation;
// ExplorerPanel supplies the live Webview. Keeping the message shapes here — next
// to a test that pins them — is what keeps this host half in lockstep with the
// frontend bridge across the boundary.

import type { GraphSnapshot } from "../../../core/graph/export.js";
import type { PresentationCommand } from "../../../core/presentation/command.js";
import { isIngestPhase, type IngestEvent } from "../../../core/ingest/progress.js";

/** webview → host: "mounted, send me the graph." */
export const READY_TYPE = "codegraph:ready" as const;
/** webview → host: "reveal this file in the editor" (FR-31). Carries only the
 * repo-RELATIVE path + 0-based position; the host resolves it against the
 * absolute editorRoot it owns (AD-16), so the host path never enters the webview. */
export const OPEN_FILE_TYPE = "codegraph:openFile" as const;
/** host → webview: the live graph to render (source stays host-local, AD-16). */
export const SNAPSHOT_TYPE = "codegraph:snapshot" as const;
/** host → webview: a live presentation directive from the agent (FR-39). Ephemeral
 * — it drives the view and is NEVER folded into the portable GraphSnapshot. */
export const COMMAND_TYPE = "codegraph:command" as const;
/** host → webview: a live repo-ingestion progress tick (FR-55). Counts + a
 * repo-relative current file only — never source bytes / an absolute path
 * (AD-16/AD-14) — so the live-progress UI can render without a host round-trip. */
export const INGEST_TYPE = "codegraph:ingest" as const;
/** webview → host: "(re)index this workspace" (FR-55 user trigger). Carries no
 * payload — the host already owns the workspace root and scan options. */
export const INDEX_REQUEST_TYPE = "codegraph:indexRepo" as const;
/** host → webview: a BASELINE graph to diff the live graph against (T14.4 / FR-69).
 * The extension's "Diff Against Git Ref" builds the baseline graph on the host
 * (baselineGraph) and posts it here so the webview's client diff (computeGraphDiff)
 * lights the Diff lens in the unified board. Source-blind — graph identities +
 * structure + relative-path metadata only, never source bytes / an absolute host
 * path (AD-14) — the same portable shape as SNAPSHOT_TYPE, minus host-local docs. */
export const BASELINE_TYPE = "codegraph:baseline" as const;

export interface SnapshotMessage {
  readonly type: typeof SNAPSHOT_TYPE;
  readonly snapshot: GraphSnapshot;
  /**
   * Absolute repo root on the host, for "open in editor" deep links (FR-32).
   * Transport-only and deliberately NOT a field of GraphSnapshot: the snapshot
   * is a portable, shareable artifact, so persisting a host filesystem path in
   * it would leak the layout (AD-14). It rides the live webview message instead,
   * where the host owns the source anyway (AD-16). Absent when no workspace root
   * is known.
   */
  readonly editorRoot?: string;
}

/** True when an inbound webview message is the export's readiness ping. */
export function isReadyMessage(msg: unknown): boolean {
  return (
    typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === READY_TYPE
  );
}

/** webview → host: a reveal-in-editor request (FR-31). The file is repo-relative
 *  and the position is 0-based (a vscode.Position is 0-based, so no off-by-one). */
export interface OpenFileMessage {
  readonly type: typeof OPEN_FILE_TYPE;
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
}

const MAX_FILE_LEN = 4096;

function clampIndex(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/**
 * Parse + SAFEGUARD an inbound webview openFile request (FR-31). The webview is
 * UNTRUSTED and the host joins `file` onto its absolute root, so this rejects
 * anything that isn't a clean repo-relative path: a non-string/empty/over-long
 * file, an absolute path (POSIX `/…`, UNC/backslash, or a Windows `C:` drive),
 * and any `..` segment (traversal). Returns the normalized request, or null when
 * the message isn't a well-formed, safe openFile. Deliberately string-only (no
 * node:path) so it stays pure and frontend-allowlist-safe; the host adds a
 * resolve-within-root check as defense in depth.
 */
export function parseOpenFileMessage(
  msg: unknown,
): { file: string; line?: number; column?: number } | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as { type?: unknown; file?: unknown; line?: unknown; column?: unknown };
  if (m.type !== OPEN_FILE_TYPE) return null;
  if (typeof m.file !== "string" || m.file.length === 0 || m.file.length > MAX_FILE_LEN) return null;
  if (/^([/\\]|[A-Za-z]:)/.test(m.file)) return null; // absolute (POSIX / UNC / drive)
  if (m.file.split(/[/\\]/).some((seg) => seg === "..")) return null; // parent-dir escape
  const line = clampIndex(m.line);
  const column = clampIndex(m.column);
  return {
    file: m.file,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

/** host → webview: the presentation-command envelope the export's bridge expects.
 *  The command is graph-identity addressed + view directives only — no source,
 *  no host path — so it is cloud-safe (AD-14) and read-only (FR-9). */
export interface CommandMessage {
  readonly type: typeof COMMAND_TYPE;
  readonly command: PresentationCommand;
}

/** Wrap a validated presentation command in its host → webview envelope. */
export function commandMessage(command: PresentationCommand): CommandMessage {
  return { type: COMMAND_TYPE, command };
}

/** host → webview: the baseline-graph envelope for the git-ref diff (T14.4). The
 *  snapshot is a source-blind graph (identities + structure), so it is cloud-safe
 *  (AD-14) and read-only (FR-9); the webview diffs the live graph against it. */
export interface BaselineMessage {
  readonly type: typeof BASELINE_TYPE;
  readonly snapshot: GraphSnapshot;
}

/** Wrap a baseline graph snapshot in its host → webview envelope. */
export function baselineMessage(snapshot: GraphSnapshot): BaselineMessage {
  return { type: BASELINE_TYPE, snapshot };
}

/** The host → webview snapshot envelope the export's bridge expects. The
 *  absolute `editorRoot` is folded in only when the host knows one (an open
 *  workspace), so a rootless build posts a minimal envelope. */
export function snapshotMessage(snapshot: GraphSnapshot, editorRoot?: string): SnapshotMessage {
  return { type: SNAPSHOT_TYPE, snapshot, ...(editorRoot ? { editorRoot } : {}) };
}

/**
 * `webview.asWebviewUri(dir)` yields a slashless URI; the injected `<base>` needs
 * a trailing slash so the export's relative `./_next/…` and `benchmark/…` URLs
 * resolve against the export directory, not its parent. Idempotent.
 */
export function withTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

/** host → webview: a live ingestion progress tick (FR-55). */
export interface IngestMessage {
  readonly type: typeof INGEST_TYPE;
  readonly event: IngestEvent;
}

const MAX_NUM = Number.MAX_SAFE_INTEGER;

function safeCount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_NUM ? Math.floor(v) : undefined;
}

/**
 * Parse + SAFEGUARD a progress event for the wire (FR-55). The phase is validated
 * against the single-source core guard; counts are coerced to safe non-negative
 * integers (dropped when invalid); the optional `file`/`message` are kept only
 * when strings and length-clamped. Returns null when the phase is missing/bad, so
 * a malformed tick is dropped at the boundary rather than driving the UI. Used by
 * the host to build a clean message AND mirrored frontend-side as a defensive
 * guard on inbound data.
 */
export function parseIngestEvent(raw: unknown): IngestEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isIngestPhase(r.phase)) return null;
  const file = typeof r.file === "string" ? r.file.slice(0, MAX_FILE_LEN) : undefined;
  const message = typeof r.message === "string" ? r.message.slice(0, MAX_FILE_LEN) : undefined;
  const found = safeCount(r.found);
  const parsed = safeCount(r.parsed);
  const failed = safeCount(r.failed);
  const nodes = safeCount(r.nodes);
  const edges = safeCount(r.edges);
  return {
    phase: r.phase,
    ...(found !== undefined ? { found } : {}),
    ...(parsed !== undefined ? { parsed } : {}),
    ...(failed !== undefined ? { failed } : {}),
    ...(nodes !== undefined ? { nodes } : {}),
    ...(edges !== undefined ? { edges } : {}),
    ...(file !== undefined ? { file } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}

/** Wrap a progress event in its host → webview envelope (drops a malformed event). */
export function ingestMessage(event: IngestEvent): IngestMessage | null {
  const safe = parseIngestEvent(event);
  return safe ? { type: INGEST_TYPE, event: safe } : null;
}

/** True when an inbound webview message is a "(re)index this workspace" request. */
export function isIndexRequestMessage(msg: unknown): boolean {
  return (
    typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === INDEX_REQUEST_TYPE
  );
}
