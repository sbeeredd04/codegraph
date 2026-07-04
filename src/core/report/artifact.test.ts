import { describe, it, expect } from "vitest";
import { buildGraphArtifact, ARTIFACT_DIR } from "./artifact.js";
import { parseGraphSnapshot } from "../graph/export.js";
import type { GraphNode, GraphEdge } from "../graph/types.js";

const node = (address: string, kind: GraphNode["kind"], extra: Partial<GraphNode> = {}): GraphNode => ({
  address,
  kind,
  name: address.split(/[#.]/).pop() ?? address,
  location: { file: address.split(":")[1]?.split("#")[0] ?? "a.ts", line: 0, character: 0 },
  ...extra,
});

const NODES: GraphNode[] = [
  node("ts:a.ts", "module"),
  node("ts:a.ts#login", "function", { doc: "/** Signs a user in. */", signature: "login(u: string): void" }),
];
const EDGES: GraphEdge[] = [{ from: "ts:a.ts", to: "ts:a.ts#login", type: "contains" }];

describe("buildGraphArtifact (FR-91)", () => {
  it("emits graph.json and GRAPH_REPORT.md", () => {
    const artifact = buildGraphArtifact(NODES, EDGES, { root: "/repo" });
    expect(artifact.files.map((f) => f.name).sort()).toEqual(["GRAPH_REPORT.md", "graph.json"]);
  });

  it("graph.json round-trips through parseGraphSnapshot with the nodes intact", () => {
    const artifact = buildGraphArtifact(NODES, EDGES, { root: "/repo" });
    const json = artifact.files.find((f) => f.name === "graph.json")!.content;
    const parsed = parseGraphSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.snapshot.nodeCount).toBe(2);
      expect(parsed.snapshot.nodes.find((n) => n.address === "ts:a.ts#login")?.signature).toBe("login(u: string): void");
    }
  });

  it("GRAPH_REPORT.md is a Markdown doc with a heading", () => {
    const report = buildGraphArtifact(NODES, EDGES, { root: "/repo" }).files.find((f) => f.name === "GRAPH_REPORT.md")!;
    expect(report.content).toMatch(/^# /m);
  });

  it("keeps host-local doc by default (a LOCAL artifact), strips it when asked", () => {
    const local = buildGraphArtifact(NODES, EDGES);
    expect(local.snapshot.nodes.find((n) => n.address === "ts:a.ts#login")).toHaveProperty("doc");
    const portable = buildGraphArtifact(NODES, EDGES, { keepHostLocal: false });
    expect(portable.snapshot.nodes.find((n) => n.address === "ts:a.ts#login")).not.toHaveProperty("doc");
    // The structural signature survives either way.
    expect(portable.snapshot.nodes.find((n) => n.address === "ts:a.ts#login")?.signature).toBe("login(u: string): void");
  });

  it("names the artifact directory `.codegraph` (a skipped dot-dir)", () => {
    expect(ARTIFACT_DIR).toBe(".codegraph");
  });
});
