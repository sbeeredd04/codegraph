import { describe, it, expect } from "vitest";
import {
  READY_TYPE,
  SNAPSHOT_TYPE,
  isReadyMessage,
  snapshotMessage,
  withTrailingSlash,
} from "./explorer-protocol.js";
import type { GraphSnapshot } from "../../../core/graph/export.js";

const SNAPSHOT: GraphSnapshot = {
  version: 1,
  root: "live-repo",
  nodeCount: 1,
  edgeCount: 0,
  nodes: [
    { address: "a", kind: "module", name: "a.ts", location: { file: "a.ts", line: 0, character: 0 } },
  ],
  edges: [],
};

describe("explorer-protocol — the host↔export message contract", () => {
  it("recognises the export's readiness ping and nothing else", () => {
    expect(isReadyMessage({ type: READY_TYPE })).toBe(true);
    // The frontend bridge emits exactly this string — guard against drift.
    expect(READY_TYPE).toBe("codegraph:ready");

    expect(isReadyMessage({ type: "ready" })).toBe(false); // the bespoke panel's verb
    expect(isReadyMessage({ type: SNAPSHOT_TYPE })).toBe(false);
    expect(isReadyMessage(null)).toBe(false);
    expect(isReadyMessage("codegraph:ready")).toBe(false);
    expect(isReadyMessage(undefined)).toBe(false);
  });

  it("wraps a snapshot in the envelope the frontend's isSnapshotMessage accepts", () => {
    const msg = snapshotMessage(SNAPSHOT);
    expect(msg.type).toBe("codegraph:snapshot");
    expect(msg.snapshot).toBe(SNAPSHOT);
    // Mirror frontend/lib/webview-bridge.ts#isSnapshotMessage.
    expect(typeof msg.snapshot).toBe("object");
    expect(msg.snapshot).not.toBeNull();
  });

  it("guarantees a single trailing slash on the base href, idempotently", () => {
    expect(withTrailingSlash("vscode-webview://x/media/explorer")).toBe(
      "vscode-webview://x/media/explorer/",
    );
    expect(withTrailingSlash("vscode-webview://x/media/explorer/")).toBe(
      "vscode-webview://x/media/explorer/",
    );
  });
});
