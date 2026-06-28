// Seed the self-portrait sample snapshot with a few agent-style knowledge
// diagrams (Epic 7 / FR-28), so the standalone web demo and the e2e harness
// exercise the Diagrams drawer on real content. In the real product these are
// authored by the user's connected agent via the save_diagram MCP tool; here we
// hand-author an equivalent set ABOUT codegraph itself and fold them into the
// committed codegraph.json fixture. Each `related` address is a real node in that
// fixture, so the drawer's cross-highlight (jump-to-node) lands on a live node.
//
//   npx tsx scripts/seed-sample-diagrams.ts
//
// Idempotent: re-running replaces the snapshot's `diagrams` array in place. The
// sources go through the core's own validateDiagram so they are shaped exactly
// like agent output (validated, slugged ids, length-capped, untrusted-by-contract).
import * as path from "node:path";
import * as fs from "node:fs";
import { validateDiagram, type DiagramInput } from "../src/core/diagrams/diagram.js";
import type { GraphSnapshot } from "../src/core/graph/export.js";

const FIXTURE = path.resolve("frontend/public/benchmark/codegraph.json");
const STAMP = "2026-06-28T00:00:00.000Z";

// Hand-authored demo diagrams. Categories deliberately span four buckets so the
// drawer's category grouping is visible. `related` addresses are verified present
// in the fixture below before writing.
const SOURCES: DiagramInput[] = [
  {
    title: "System architecture",
    category: "architecture",
    description: "How the pure core feeds both the VS Code panel and the web explorer.",
    related: [
      "ts:src/extension/index.ts",
      "ts:src/core/graph/export.ts",
      "ts:src/adapters/surfaces/webview/panel.ts",
      "ts:src/core/graph/projection.ts",
    ],
    mermaid: `flowchart TD
  ext["VS Code extension"] --> core["Pure graph core"]
  core --> proj["Projection"]
  core --> snap["GraphSnapshot export"]
  snap --> panel["Webview panel"]
  snap --> web["Next explorer"]
  web --> surf["Sigma 2D / Canvas 3D"]`,
  },
  {
    title: "Indexing a repository",
    category: "workflow",
    description: "What happens from opening a folder to a rendered board.",
    related: ["ts:src/extension/index.ts", "ts:src/core/graph/types.ts"],
    mermaid: `sequenceDiagram
  participant U as User
  participant E as Extension
  participant B as Bootstrap
  participant G as Graph core
  U->>E: Open folder
  E->>B: Parse sources (tree-sitter)
  B->>G: Add nodes and edges
  G-->>E: Canonical graph
  E-->>U: Render board`,
  },
  {
    title: "Snapshot to render model",
    category: "dataflow",
    description: "The data contract that the standalone viewer consumes.",
    related: [
      "ts:src/core/graph/export.ts",
      "ts:src/adapters/surfaces/webview/render-model.ts",
    ],
    mermaid: `flowchart LR
  graph["Canonical graph"] --> export["exportGraphSnapshot"]
  export --> json["GraphSnapshot JSON"]
  json --> render["buildRenderModel"]
  render --> nodes["Node display"]`,
  },
  {
    title: "Projection modes",
    category: "state",
    description: "The four lenses the explorer switches between.",
    related: ["ts:src/core/graph/projection.ts"],
    mermaid: `stateDiagram-v2
  [*] --> Full
  Full --> Depends
  Full --> Calls
  Full --> Structure
  Depends --> Full
  Calls --> Full
  Structure --> Full`,
  },
];

function main(): void {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const snap = JSON.parse(raw) as GraphSnapshot;
  const addresses = new Set(snap.nodes.map((n) => n.address));

  const diagrams = SOURCES.map((input) => {
    const r = validateDiagram({ ...input, updatedAt: STAMP });
    if (!r.ok) throw new Error(`Bad seed diagram "${String(input.title)}": ${r.error}`);
    // Drop any related address that is not actually in the fixture, so the
    // cross-highlight never points at a missing node.
    const related = (input.related as string[] | undefined)?.filter((a) => addresses.has(a));
    const missing = (input.related as string[] | undefined)?.filter((a) => !addresses.has(a)) ?? [];
    if (missing.length) {
      process.stderr.write(`warning: dropping unknown related addresses: ${missing.join(", ")}\n`);
    }
    return related && related.length ? { ...r.diagram, related } : { ...r.diagram, related: undefined };
  });

  const next: GraphSnapshot = { ...snap, diagrams };
  fs.writeFileSync(FIXTURE, JSON.stringify(next));
  process.stdout.write(
    `seeded ${diagrams.length} diagrams into ${path.relative(process.cwd(), FIXTURE)}\n`,
  );
}

main();
