import { describe, it, expect } from "vitest";
import {
  READY_TYPE,
  SNAPSHOT_TYPE,
  COMMAND_TYPE,
  OPEN_FILE_TYPE,
  INGEST_TYPE,
  INDEX_REQUEST_TYPE,
  isReadyMessage,
  parseOpenFileMessage,
  snapshotMessage,
  commandMessage,
  ingestMessage,
  parseIngestEvent,
  isIndexRequestMessage,
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

  it("folds an absolute editorRoot into the envelope only when the host has one (FR-32)", () => {
    const withRoot = snapshotMessage(SNAPSHOT, "/Users/me/proj");
    expect(withRoot.editorRoot).toBe("/Users/me/proj");
    // SNAPSHOT_TYPE is unaffected — older bridges that ignore editorRoot still parse it.
    expect(withRoot.type).toBe("codegraph:snapshot");

    // The root is transport-only — it must never be written onto the snapshot
    // itself (that artifact is shareable; a host path would leak the layout).
    expect("editorRoot" in withRoot.snapshot).toBe(false);

    // A rootless host posts a minimal envelope, not editorRoot: undefined.
    expect("editorRoot" in snapshotMessage(SNAPSHOT)).toBe(false);
  });

  it("wraps a presentation command in its host → webview envelope (FR-39)", () => {
    const msg = commandMessage({ kind: "highlight_nodes", addresses: ["a", "b"] });
    expect(msg.type).toBe("codegraph:command");
    expect(COMMAND_TYPE).toBe("codegraph:command"); // mirror webview-bridge — guard drift
    expect(msg.command).toEqual({ kind: "highlight_nodes", addresses: ["a", "b"] });
    // A command is ephemeral — it must never ride the snapshot envelope.
    expect("command" in snapshotMessage(SNAPSHOT)).toBe(false);
  });

  it("accepts a well-formed webview reveal-in-editor request (FR-31)", () => {
    expect(OPEN_FILE_TYPE).toBe("codegraph:openFile"); // mirror webview-bridge — guard drift
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "src/beta.ts", line: 1, column: 2 })).toEqual({
      file: "src/beta.ts",
      line: 1,
      column: 2,
    });
    // Position is optional; a bare file reveals the top of the document.
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "a.ts" })).toEqual({ file: "a.ts" });
    // Non-finite / negative indices are dropped, not passed through.
    expect(
      parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "a.ts", line: -3, column: Infinity }),
    ).toEqual({ file: "a.ts" });
    // Fractional indices floor to whole lines/columns.
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "a.ts", line: 4.9 })).toEqual({
      file: "a.ts",
      line: 4,
    });
  });

  it("rejects unsafe or malformed reveal requests (untrusted webview → path traversal)", () => {
    // The host joins `file` onto its absolute root, so traversal must be impossible.
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "/etc/passwd" })).toBeNull(); // absolute POSIX
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "C:\\Windows\\x" })).toBeNull(); // Windows drive
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "\\\\srv\\share" })).toBeNull(); // UNC
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "../../secret" })).toBeNull(); // parent escape
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "src/../../x" })).toBeNull(); // mid-path escape
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "" })).toBeNull(); // empty
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: "a".repeat(5000) })).toBeNull(); // over-long
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE })).toBeNull(); // no file
    expect(parseOpenFileMessage({ type: OPEN_FILE_TYPE, file: 42 })).toBeNull(); // non-string
    // Wrong / missing type is not a reveal request.
    expect(parseOpenFileMessage({ type: READY_TYPE, file: "a.ts" })).toBeNull();
    expect(parseOpenFileMessage(null)).toBeNull();
    expect(parseOpenFileMessage("codegraph:openFile")).toBeNull();
  });

  it("wraps a clean ingestion progress tick in its host → webview envelope (FR-55)", () => {
    expect(INGEST_TYPE).toBe("codegraph:ingest"); // mirror webview-bridge — guard drift
    const msg = ingestMessage({ phase: "parsing", found: 10, parsed: 4, nodes: 12, edges: 5, file: "src/a.ts" });
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("codegraph:ingest");
    expect(msg!.event).toEqual({ phase: "parsing", found: 10, parsed: 4, nodes: 12, edges: 5, file: "src/a.ts" });
    // Progress is ephemeral — never folded into the portable snapshot.
    expect("event" in snapshotMessage(SNAPSHOT)).toBe(false);
  });

  it("sanitises an ingestion tick: bad phase dropped, bad counts coerced (FR-55)", () => {
    // A bad phase → the whole tick is dropped (null), never drives the UI.
    expect(parseIngestEvent({ phase: "exploding" })).toBeNull();
    expect(parseIngestEvent({ found: 3 })).toBeNull(); // no phase
    expect(parseIngestEvent(null)).toBeNull();
    // Negative / non-finite / fractional counts are dropped or floored, not passed through.
    expect(parseIngestEvent({ phase: "parsing", found: -2, parsed: Infinity, nodes: 7.9 })).toEqual({
      phase: "parsing",
      nodes: 7,
    });
    // A repo-relative file is kept; an over-long string is clamped (never unbounded).
    const long = parseIngestEvent({ phase: "discovering", file: "a".repeat(5000) });
    expect(long!.file!.length).toBe(4096);
    // ingestMessage drops a malformed event rather than wrapping it.
    expect(ingestMessage({ phase: "nope" as never })).toBeNull();
  });

  it("recognises a webview (re)index request and nothing else (FR-55)", () => {
    expect(INDEX_REQUEST_TYPE).toBe("codegraph:indexRepo"); // mirror webview-bridge — guard drift
    expect(isIndexRequestMessage({ type: INDEX_REQUEST_TYPE })).toBe(true);
    expect(isIndexRequestMessage({ type: READY_TYPE })).toBe(false);
    expect(isIndexRequestMessage(null)).toBe(false);
    expect(isIndexRequestMessage("codegraph:indexRepo")).toBe(false);
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
