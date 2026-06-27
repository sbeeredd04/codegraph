import * as path from "node:path";
import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrapRepo } from "../lang/bootstrap.js";
import { createGraphMcpServer } from "./server.js";
import type { CodeGraph } from "../../core/graph/graph.js";

// Launchable MCP server (FR-13): `node codegraph-mcp.js <repoRoot>`. The user's
// AI agent connects over stdio and queries the same graph the human reads — the
// moat. Logs go to stderr; stdout is reserved for the MCP protocol channel.

const require = createRequire(__filename);

function wasmDir(): string {
  return path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? process.cwd();
  const { graph, coverage } = await bootstrapRepo(root, wasmDir());
  let current: CodeGraph = graph;

  const server = createGraphMcpServer(() => current);
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `codegraph MCP ready on ${root} — ${coverage.parsed}/${coverage.found} files, ` +
      `${graph.order} nodes, ${graph.size} edges\n`,
  );
  void current; // reserved: a future re-scan tool will reassign `current`.
}

main().catch((err: unknown) => {
  process.stderr.write(`codegraph MCP failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
