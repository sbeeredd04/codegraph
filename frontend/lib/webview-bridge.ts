// Bridge between the Next export and its VS Code webview host (Epic 7.4). On the
// standalone web the host is absent and the app loads a bundled sample; inside
// the webview the host posts the LIVE GraphSnapshot, which the app renders
// instead. Only the graph (identities + structure) is posted — source still
// never leaves the host (AD-14 / AD-16).

import type { GraphSnapshot } from "@core/graph/export";

/** Host → webview: the live graph to render. */
export interface SnapshotMessage {
  readonly type: "codegraph:snapshot";
  readonly snapshot: GraphSnapshot;
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

function isSnapshotMessage(data: unknown): data is SnapshotMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as { type?: unknown; snapshot?: unknown };
  return m.type === "codegraph:snapshot" && typeof m.snapshot === "object" && m.snapshot !== null;
}

/**
 * Subscribe to live snapshots from the host and announce readiness (mirrors the
 * bespoke webview's ready/render handshake). Returns an unsubscribe fn. Safe to
 * call outside a webview — the handler simply never fires.
 */
export function subscribeToSnapshot(onSnapshot: (snap: GraphSnapshot) => void): () => void {
  const onMessage = (e: MessageEvent): void => {
    if (isSnapshotMessage(e.data)) onSnapshot(e.data.snapshot);
  };
  window.addEventListener("message", onMessage);
  vscode()?.postMessage({ type: "codegraph:ready" } satisfies ReadyMessage);
  return () => window.removeEventListener("message", onMessage);
}
