import * as path from "node:path";
import { CodeGraph } from "../../core/graph/graph.js";
import { answerQuestion, renderAnswer } from "../../core/query/answer.js";
import { readGraphArtifact } from "../../adapters/artifact/read.js";
import type { CliCommand, CliInvocation } from "../runtime.js";

/** FR-95: answer a natural-language question from the persisted `.codegraph/graph.json`
 *  — the single model-friendly entry (graphify's `query`). No scan: reads the artifact,
 *  rebuilds the graph, and prints a grounded answer with file:line citations. */
function runQuery(root: string, question: string): void {
  if (!question.trim()) {
    process.stderr.write('codegraph: usage: codegraph query "<question>"\n');
    process.exitCode = 1;
    return;
  }
  const loaded = readGraphArtifact(root);
  if (!loaded) {
    process.stderr.write(
      "codegraph: no .codegraph/graph.json here — run `codegraph graph .` first to build it.\n",
    );
    process.exitCode = 1;
    return;
  }
  const graph = new CodeGraph();
  for (const node of loaded.snapshot.nodes) graph.addNode(node);
  for (const edge of loaded.snapshot.edges) graph.addEdge(edge);
  process.stdout.write(`${renderAnswer(answerQuestion(graph, question))}\n`);
}

export const queryCommand: CliCommand = {
  name: "query",
  usage: 'codegraph query "<q>"',
  summary: 'answer a question from .codegraph/graph.json, grounded (e.g. "what calls login")',
  // Everything after `query` is the question (so it works quoted or bare); the artifact
  // is read from the cwd — `codegraph graph .` must have written it first.
  run: (inv: CliInvocation) => runQuery(resolveRootCwd(inv), inv.positionals.join(" ")),
};

/** query always reads the cwd's artifact (its positionals are the question, not a dir). */
function resolveRootCwd(inv: CliInvocation): string {
  return path.resolve(inv.cwd);
}
