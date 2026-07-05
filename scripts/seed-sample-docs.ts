// Seed the self-portrait sample snapshot with a couple of agent-style knowledge
// docs (Epic 7 / FR-29), so the standalone web demo and the e2e harness exercise
// the Docs drawer on real prose. In the real product these are authored by the
// user's connected agent via the save_doc MCP tool; here we hand-author an
// equivalent set ABOUT codegraph and fold them into the committed codegraph.json
// fixture. The bodies include `codegraph://node/<address>` deep-links and a
// `related` list, both pointing at real nodes in the fixture, so the drawer's
// cross-highlight (jump-to-node) lands on a live node.
//
//   npx tsx scripts/seed-sample-docs.ts
//
// Idempotent: re-running replaces the snapshot's `docs` array in place. Sources go
// through the core's own validateDoc so they are shaped exactly like agent output.
import * as path from "node:path";
import * as fs from "node:fs";
import { validateDoc, type DocInput } from "../src/core/docs/doc.js";
import type { GraphSnapshot } from "../src/core/graph/export.js";

const FIXTURE = path.resolve("frontend/public/benchmark/codegraph.json");
const STAMP = "2026-06-28T00:00:00.000Z";

// Markdown is built from line arrays (not template literals) so code fences and
// inline-code backticks stay literal.
const archBody = [
  "codegraph is a **hexagonal** application: a pure, framework-free core",
  "surrounded by thin adapters.",
  "",
  "## Three layers of understanding",
  "",
  "| Layer | What it captures |",
  "| --- | --- |",
  "| Graph | Precise structure — nodes and edges |",
  "| Diagrams | Narrative shapes the agent draws |",
  "| Docs | Long-form prose (this) |",
  "",
  "## The hexagon",
  "",
  "```mermaid",
  "flowchart LR",
  '  adapters["Adapters: VS Code · CLI · MCP"] --> core["Pure core"]',
  '  core --> snap["Portable snapshot"]',
  "```",
  "",
  "## Key seams",
  "",
  "- The canonical graph exports a portable snapshot via",
  "  [`exportGraphSnapshot`](codegraph://node/ts:src/core/graph/export.ts).",
  "- The VS Code surface lives in the",
  "  [webview panel](codegraph://node/ts:src/adapters/surfaces/webview/panel.ts).",
  "",
  "> The core never imports `vscode`, `fs`, or the network — that boundary is",
  "> enforced in CI by dependency-cruiser.",
].join("\n");

const startBody = [
  "1. Open a folder in VS Code.",
  "2. The [extension](codegraph://node/ts:src/extension/index.ts) parses your",
  "   sources and builds the graph.",
  "3. Explore: switch projections, focus a node, trace a path.",
  "",
  "Run the full gate with:",
  "",
  "```",
  "npm run verify",
  "```",
  "",
  "Everything is **read-only** — codegraph never edits your source.",
].join("\n");

const SOURCES: DocInput[] = [
  {
    title: "Architecture overview",
    category: "architecture",
    related: ["ts:src/core/graph/export.ts", "ts:src/adapters/surfaces/webview/panel.ts"],
    markdown: archBody,
  },
  {
    title: "Getting started",
    category: "onboarding",
    related: ["ts:src/extension/index.ts"],
    markdown: startBody,
  },
];

function main(): void {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const snap = JSON.parse(raw) as GraphSnapshot;
  const addresses = new Set(snap.nodes.map((n) => n.address));

  const docs = SOURCES.map((input) => {
    const r = validateDoc({ ...input, updatedAt: STAMP });
    if (!r.ok) throw new Error(`Bad seed doc "${String(input.title)}": ${r.error}`);
    const related = (input.related as string[] | undefined)?.filter((a) => addresses.has(a));
    const missing = (input.related as string[] | undefined)?.filter((a) => !addresses.has(a)) ?? [];
    if (missing.length) process.stderr.write(`warning: dropping unknown related: ${missing.join(", ")}\n`);
    return related && related.length ? { ...r.doc, related } : { ...r.doc, related: undefined };
  });

  const next: GraphSnapshot = { ...snap, docs };
  fs.writeFileSync(FIXTURE, JSON.stringify(next));
  process.stdout.write(`seeded ${docs.length} docs into ${path.relative(process.cwd(), FIXTURE)}\n`);
}

main();
