import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeGraphArtifact } from "./write.js";
import { buildGraphArtifact } from "../../core/report/artifact.js";
import type { GraphNode, GraphEdge } from "../../core/graph/types.js";

const NODES: GraphNode[] = [
  { address: "ts:a.ts", kind: "module", name: "a.ts", location: { file: "a.ts", line: 0, character: 0 } },
  { address: "ts:a.ts#f", kind: "function", name: "f", location: { file: "a.ts", line: 1, character: 0 } },
];
const EDGES: GraphEdge[] = [{ from: "ts:a.ts", to: "ts:a.ts#f", type: "contains" }];

describe("writeGraphArtifact (FR-91)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes graph.json + GRAPH_REPORT.md into <baseDir>/.codegraph and returns the dir", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-artifact-"));
    const artifact = buildGraphArtifact(NODES, EDGES, { root: dir });
    const outDir = writeGraphArtifact(dir, artifact);

    expect(outDir).toBe(path.join(dir, ".codegraph"));
    expect(fs.existsSync(path.join(outDir, "graph.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "GRAPH_REPORT.md"))).toBe(true);
    // The written graph.json is the artifact's content verbatim.
    const written = JSON.parse(fs.readFileSync(path.join(outDir, "graph.json"), "utf8"));
    expect(written.nodeCount).toBe(2);
  });

  it("creates the .codegraph dir if it does not exist yet", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-artifact-"));
    expect(fs.existsSync(path.join(dir, ".codegraph"))).toBe(false);
    writeGraphArtifact(dir, buildGraphArtifact(NODES, EDGES));
    expect(fs.statSync(path.join(dir, ".codegraph")).isDirectory()).toBe(true);
  });
});
