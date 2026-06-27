import * as path from "node:path";
import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrapRepo } from "../lang/bootstrap.js";
import { baselineGraph } from "../git/baseline.js";
import { diffGraphs } from "../../core/graph/diff.js";
import { rankedChangeFeed } from "../../core/graph/change-feed.js";
import { createNodeAnnotations } from "../../core/semantic/annotations.js";
import { diskEnrichmentCache } from "../semantic/disk-cache.js";
import { enrichmentCachePath } from "../semantic/cache-path.js";
import { diskDiagramStore } from "../diagrams/disk-store.js";
import { diagramsCachePath } from "../diagrams/cache-path.js";
import { createGraphMcpServer } from "./server.js";
import type { RecentChanges } from "./tools.js";
import type { CodeGraph } from "../../core/graph/graph.js";

// Launchable MCP server (FR-13): `node codegraph-mcp.js <repoRoot>`. The user's
// AI agent connects over stdio and queries the same graph the human reads — the
// moat. Logs go to stderr; stdout is reserved for the MCP protocol channel.

const require = createRequire(__filename);
// Cap the change-feed payload; `summary` still reports the true totals.
const MAX_FEED = 50;

function wasmDir(): string {
  return path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? process.cwd();
  const { graph, coverage } = await bootstrapRepo(root, wasmDir());
  let current: CodeGraph = graph;

  // The `recent_changes` provider does the I/O the pure tool layer can't: re-scan
  // the working tree (and refresh `current` so every tool sees the latest), build
  // the git baseline at `ref`, then diff and rank. Read-only w.r.t. the tree (FR-9).
  const recentChanges = async (ref: string): Promise<RecentChanges> => {
    const fresh = await bootstrapRepo(root, wasmDir());
    current = fresh.graph;
    const baseline = await baselineGraph(root, ref, wasmDir());
    const delta = diffGraphs(baseline, current);
    const changes = rankedChangeFeed(delta, baseline, current).slice(0, MAX_FEED);
    return {
      ref,
      summary: {
        added: delta.added.length,
        removed: delta.removed.length,
        changed: delta.changed.length,
        moved: delta.movedRenamed.length,
      },
      changes,
    };
  };

  // Agent-driven enrichment (Epic 4): the connected agent annotates nodes via the
  // annotate_node tool; we cache by content hash so an annotation survives a move
  // but goes stale on a signature change. The cache path is shared with the
  // extension board (enrichmentCachePath) so what the agent writes, the human sees.
  const annotations = createNodeAnnotations(
    () => current,
    diskEnrichmentCache(enrichmentCachePath(root)),
  );

  // Agent-authored knowledge diagrams (Epic 7): the connected agent explores the
  // graph and saves categorized Mermaid diagrams via save_diagram; we persist them
  // at a per-repo path shared with the extension board (diagramsCachePath) so what
  // the agent draws, the human sees. Metadata only — never touches source (FR-9).
  const diagrams = diskDiagramStore(diagramsCachePath(root));

  const server = createGraphMcpServer(() => current, recentChanges, annotations, diagrams);
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `codegraph MCP ready on ${root} — ${coverage.parsed}/${coverage.found} files, ` +
      `${graph.order} nodes, ${graph.size} edges\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`codegraph MCP failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
