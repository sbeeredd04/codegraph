import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readGraphArtifact } from "./read.js";
import { writeGraphArtifact } from "./write.js";
import { buildGraphArtifact } from "../../core/report/artifact.js";
import { injectSnapshot } from "../serve/inject.js";
import type { GraphNode, GraphEdge } from "../../core/graph/types.js";

const NODES: GraphNode[] = [
  { address: "ts:a.ts", kind: "module", name: "a.ts", location: { file: "a.ts", line: 0, character: 0 } },
  { address: "ts:a.ts#f", kind: "function", name: "f", location: { file: "a.ts", line: 1, character: 0 } },
];
const EDGES: GraphEdge[] = [{ from: "ts:a.ts", to: "ts:a.ts#f", type: "contains" }];

describe("readGraphArtifact (FR-93)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a written artifact back into a snapshot", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-read-"));
    writeGraphArtifact(dir, buildGraphArtifact(NODES, EDGES, { root: dir }));

    const loaded = readGraphArtifact(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.snapshot.nodeCount).toBe(2);
    expect(loaded!.snapshot.edgeCount).toBe(1);
    expect(loaded!.mtimeMs).toBeGreaterThan(0);
    expect(loaded!.path).toBe(path.join(dir, ".codegraph", "graph.json"));
  });

  it("returns null when there is no artifact", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-read-"));
    expect(readGraphArtifact(dir)).toBeNull();
  });

  it("returns null on a corrupt graph.json (caller then rescans)", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-read-"));
    fs.mkdirSync(path.join(dir, ".codegraph"));
    fs.writeFileSync(path.join(dir, ".codegraph", "graph.json"), "{ not valid json");
    expect(readGraphArtifact(dir)).toBeNull();
  });

  it("returns null when graph.json exceeds the size cap (no huge read/parse) (T11.3)", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-read-"));
    writeGraphArtifact(dir, buildGraphArtifact(NODES, EDGES, { root: dir }));
    // A tiny cap stands in for the real 256 MiB one — the written artifact is well over 8 bytes.
    expect(readGraphArtifact(dir, { maxBytes: 8 })).toBeNull();
    // Same file loads fine under the default cap — the guard is size-gated, not blanket.
    expect(readGraphArtifact(dir)).not.toBeNull();
  });

  it("the loaded snapshot serves to the board without a scan (inject round-trip)", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-read-"));
    writeGraphArtifact(dir, buildGraphArtifact(NODES, EDGES, { root: dir }));

    const loaded = readGraphArtifact(dir)!;
    const html = injectSnapshot("<head></head><body></body>", loaded.snapshot);
    // The persisted graph's identities reach the board's boot payload verbatim.
    expect(html).toContain("ts:a.ts#f");
    expect(html).toContain("codegraph:snapshot");
  });
});
