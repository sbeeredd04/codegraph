import { bootstrapRepo } from "../../adapters/lang/bootstrap.js";
import { buildGraphArtifact } from "../../core/report/artifact.js";
import { writeGraphArtifact } from "../../adapters/artifact/write.js";
import { wasmDir, resolveRoot, type CliCommand } from "../runtime.js";

// FR-91: scan and persist the `.codegraph/` artifact — the agent + website handoff.
// Host-local + read-only (AD-16 / FR-9): reads source in place, keeps host-local
// doc/examples (this runs on the user's own machine, not the source-blind cloud).
export const graphCommand: CliCommand = {
  name: "graph",
  usage: "codegraph graph [dir]",
  summary: "scan [dir] and write a durable .codegraph/ artifact (graph.json + GRAPH_REPORT.md)",
  run: async (inv) => {
    const root = resolveRoot(inv);
    process.stderr.write(`codegraph: scanning ${root} …\n`);
    const { graph, coverage } = await bootstrapRepo(root, wasmDir());
    const artifact = buildGraphArtifact(graph.allNodes(), graph.allEdges(), {
      root,
      generatedAt: new Date().toISOString(),
    });
    const outDir = writeGraphArtifact(root, artifact);
    process.stderr.write(
      `codegraph: ${coverage.parsed}/${coverage.found} files · ${graph.order} nodes · ${graph.size} edges\n` +
        `codegraph: wrote graph.json + GRAPH_REPORT.md to ${outDir}\n`,
    );
  },
};
