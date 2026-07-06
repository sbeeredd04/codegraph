// Bridge between the Next export and its VS Code webview host (Epic 7.4). On the
// standalone web the host is absent and the app loads a bundled sample; inside
// the webview the host posts the LIVE GraphSnapshot, which the app renders
// instead. Only the graph (identities + structure) is posted — source still
// never leaves the host (AD-14 / AD-16).

import type { GraphSnapshot } from "@core/graph/export";
import {
  validatePresentationCommand,
  type PresentationCommand,
} from "@core/presentation/command";
import { isIngestPhase, type IngestEvent } from "@core/ingest/progress";

/** Host → webview: the live graph to render. */
export interface SnapshotMessage {
  readonly type: "codegraph:snapshot";
  readonly snapshot: GraphSnapshot;
  /**
   * Absolute repo root on the host, for "open in editor" deep links (FR-32).
   * Transport-only — it is NOT part of GraphSnapshot, so it never persists into
   * the shareable artifact and never reaches the source-blind cloud plane
   * (AD-14). Present only when the host has an open workspace.
   */
  readonly editorRoot?: string;
  /**
   * Base URL of a host-local source channel for the inline viewer (T14.3). Set by
   * `codegraph serve`, which runs on the user's machine where the source lives
   * (AD-16), so the board can fetch a node's file. Transport-only and absent on
   * the cloud plane and inside the VS Code webview (whose CSP blocks fetch and
   * which reveals in the editor instead) — so neither renders inline source.
   */
  readonly sourceBase?: string;
}

/** webview → host: "I'm mounted, send the graph." */
interface ReadyMessage {
  readonly type: "codegraph:ready";
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
}

// acquireVsCodeApi may be called only once per page load, so cache the handle
// (undefined = not yet resolved, null = not in a webview).
let api: VsCodeApi | null | undefined;
function vscode(): VsCodeApi | null {
  if (api !== undefined) return api;
  const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi;
  api = typeof acquire === "function" ? acquire() : null;
  return api;
}

/** True when running inside the VS Code webview host. Call from the client only. */
export function isWebviewHost(): boolean {
  return vscode() !== null;
}

/**
 * Ask the host to reveal a file in the editor (FR-31). Posts only the repo-
 * RELATIVE path + 0-based position; the host resolves it against the absolute
 * root it owns (AD-16), so the host filesystem path never enters the webview DOM
 * (unlike the FR-32 `vscode://file/<absroot>/…` fallback href). No-op off the
 * webview host — the standalone web plane has no editor to drive (AD-14).
 */
export function revealInEditor(file: string, line?: number, column?: number): void {
  vscode()?.postMessage({ type: "codegraph:openFile", file, line, column });
}

function isSnapshotMessage(data: unknown): data is SnapshotMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as { type?: unknown; snapshot?: unknown };
  return m.type === "codegraph:snapshot" && typeof m.snapshot === "object" && m.snapshot !== null;
}

/** The live graph plus any host-only context that rides alongside it. */
export interface LiveSnapshot {
  readonly snapshot: GraphSnapshot;
  /** Absolute repo root for editor deep links (FR-32); undefined off the host. */
  readonly editorRoot?: string;
  /** Host-local source channel base for the inline viewer (T14.3); set only by
   *  `codegraph serve`. Undefined in the VS Code webview and on the cloud plane. */
  readonly sourceBase?: string;
}

/**
 * Subscribe to live snapshots from the host and announce readiness (mirrors the
 * bespoke webview's ready/render handshake). Returns an unsubscribe fn. Safe to
 * call outside a webview — the handler simply never fires. The callback receives
 * the snapshot together with the transport-only `editorRoot` (when the host
 * sends one), kept out of GraphSnapshot so it never persists into the artifact.
 */
export function subscribeToSnapshot(onSnapshot: (live: LiveSnapshot) => void): () => void {
  const onMessage = (e: MessageEvent): void => {
    if (isSnapshotMessage(e.data)) {
      const editorRoot = typeof e.data.editorRoot === "string" ? e.data.editorRoot : undefined;
      const sourceBase = typeof e.data.sourceBase === "string" ? e.data.sourceBase : undefined;
      onSnapshot({ snapshot: e.data.snapshot, editorRoot, sourceBase });
    }
  };
  window.addEventListener("message", onMessage);
  vscode()?.postMessage({ type: "codegraph:ready" } satisfies ReadyMessage);
  return () => window.removeEventListener("message", onMessage);
}

/**
 * Subscribe to live presentation commands from the host (FR-39) — the agent
 * driving the board. Each inbound message is validated through the SAME core
 * codec the host uses (the command is agent-authored, hence UNTRUSTED), so a
 * malformed directive is dropped, never dispatched. Returns an unsubscribe fn;
 * safe to call outside a webview (the handler simply never fires). Commands are
 * ephemeral and never persisted — they ride the live message only.
 */
export function subscribeToPresentationCommands(
  onCommand: (command: PresentationCommand) => void,
): () => void {
  const onMessage = (e: MessageEvent): void => {
    const data = e.data as { type?: unknown; command?: unknown } | null;
    if (typeof data !== "object" || data === null || data.type !== "codegraph:command") return;
    const command = validatePresentationCommand(data.command);
    if (command) onCommand(command);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** Host → webview: a baseline graph to diff the live graph against (T14.4). */
interface BaselineMessage {
  readonly type: "codegraph:baseline";
  readonly snapshot: GraphSnapshot;
}

function isBaselineMessage(data: unknown): data is BaselineMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as { type?: unknown; snapshot?: unknown };
  if (m.type !== "codegraph:baseline" || typeof m.snapshot !== "object" || m.snapshot === null) {
    return false;
  }
  const s = m.snapshot as { nodes?: unknown; edges?: unknown };
  return Array.isArray(s.nodes) && Array.isArray(s.edges);
}

/**
 * Subscribe to a host-supplied baseline graph for the git-ref diff (T14.4). The
 * extension's "Diff Against Git Ref" posts the baseline graph here; the callback
 * arms the client diff lens against it. Inbound host data is treated as untrusted,
 * so the shape is guarded (nodes/edges arrays) before it drives the diff. Returns
 * an unsubscribe fn; safe off the webview (the handler simply never fires). The
 * baseline is graph identities + structure only — never source (AD-14).
 */
export function subscribeToBaseline(onBaseline: (snapshot: GraphSnapshot) => void): () => void {
  const onMessage = (e: MessageEvent): void => {
    if (isBaselineMessage(e.data)) onBaseline(e.data.snapshot);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/**
 * Ask the host to (re)index the workspace (FR-55 user trigger). Carries no
 * payload — the host owns the workspace root + scan options (AD-16) — and the
 * scan streams progress back as `codegraph:ingest` ticks (see
 * {@link subscribeToIngest}). No-op off the webview host: the source-blind cloud
 * plane has no host files to scan (AD-14), so the board hides the trigger there.
 */
export function requestIndex(): void {
  vscode()?.postMessage({ type: "codegraph:indexRepo" });
}

const MAX_NUM = Number.MAX_SAFE_INTEGER;
const MAX_FILE_LEN = 4096;

function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_NUM ? Math.floor(v) : undefined;
}

/**
 * Re-validate an inbound ingest tick at the webview boundary (defense in depth —
 * the host already sanitises via `parseIngestEvent`, but the frontend treats all
 * inbound host data as untrusted). Drops a missing/bad phase; coerces counts to
 * safe non-negative integers; clamps the repo-relative `file`/`message` strings.
 * Returns null when the tick can't drive the UI.
 */
function parseIngest(data: unknown): IngestEvent | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as { type?: unknown; event?: unknown };
  if (m.type !== "codegraph:ingest" || typeof m.event !== "object" || m.event === null) return null;
  const r = m.event as Record<string, unknown>;
  if (!isIngestPhase(r.phase)) return null;
  const file = typeof r.file === "string" ? r.file.slice(0, MAX_FILE_LEN) : undefined;
  const message = typeof r.message === "string" ? r.message.slice(0, MAX_FILE_LEN) : undefined;
  const found = count(r.found);
  const parsed = count(r.parsed);
  const failed = count(r.failed);
  const nodes = count(r.nodes);
  const edges = count(r.edges);
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

/**
 * Subscribe to live repo-ingestion progress ticks from the host (FR-55). Each
 * inbound tick is re-validated (untrusted host boundary) before it drives the
 * live-progress UI. Returns an unsubscribe fn; safe to call outside a webview
 * (the handler simply never fires). Ticks are ephemeral — counts + a repo-
 * relative current file only, never source / an absolute path (AD-16 / AD-14).
 */
export function subscribeToIngest(onIngest: (event: IngestEvent) => void): () => void {
  const onMessage = (e: MessageEvent): void => {
    const event = parseIngest(e.data);
    if (event) onIngest(event);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
