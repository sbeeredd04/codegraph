// Epic 7.4 — the host side of the webview↔export message contract. Mirrors
// frontend/lib/webview-bridge.ts: the Next export posts `codegraph:ready` once it
// mounts, and the host replies with `codegraph:snapshot` carrying the live graph.
//
// Pure (no vscode, no fs) so the contract is unit-testable in isolation;
// ExplorerPanel supplies the live Webview. Keeping the message shapes here — next
// to a test that pins them — is what keeps this host half in lockstep with the
// frontend bridge across the boundary.

import type { GraphSnapshot } from "../../../core/graph/export.js";

/** webview → host: "mounted, send me the graph." */
export const READY_TYPE = "codegraph:ready" as const;
/** host → webview: the live graph to render (source stays host-local, AD-16). */
export const SNAPSHOT_TYPE = "codegraph:snapshot" as const;

export interface SnapshotMessage {
  readonly type: typeof SNAPSHOT_TYPE;
  readonly snapshot: GraphSnapshot;
}

/** True when an inbound webview message is the export's readiness ping. */
export function isReadyMessage(msg: unknown): boolean {
  return (
    typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === READY_TYPE
  );
}

/** The host → webview snapshot envelope the export's bridge expects. */
export function snapshotMessage(snapshot: GraphSnapshot): SnapshotMessage {
  return { type: SNAPSHOT_TYPE, snapshot };
}

/**
 * `webview.asWebviewUri(dir)` yields a slashless URI; the injected `<base>` needs
 * a trailing slash so the export's relative `./_next/…` and `benchmark/…` URLs
 * resolve against the export directory, not its parent. Idempotent.
 */
export function withTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}
