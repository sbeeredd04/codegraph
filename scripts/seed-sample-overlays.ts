// Seed the self-portrait sample snapshot with agent-style knowledge overlays
// (Epic 19 / FR-37), so the standalone web demo and the e2e harness exercise the
// overlay affordances (a node's note + mark badges + group membership) on real
// nodes. In the real product these are pinned by the user's connected agent via
// the pin_note / mark_node / group_nodes / annotate_edge MCP tools; here we
// hand-author an equivalent set ABOUT codegraph and fold them into the committed
// codegraph.json fixture. Anchors point at real nodes/edges in the fixture so the
// detail panel renders them on a live selection.
//
//   npx tsx scripts/seed-sample-overlays.ts
//
// Idempotent: re-running replaces the snapshot's `overlays` array in place.
// Sources go through the core's own validateNote/validateMark/validateGroup so
// they are shaped exactly like agent output.
import * as path from "node:path";
import * as fs from "node:fs";
import {
  validateNote,
  validateMark,
  validateGroup,
  type Overlay,
} from "../src/core/overlays/overlay.js";
import type { GraphSnapshot } from "../src/core/graph/export.js";

const FIXTURE = path.resolve("frontend/public/benchmark/codegraph.json");
const STAMP = "2026-06-28T00:00:00.000Z";

// Anchors — real addresses in the fixture (verified at seed time below).
const CACHE_FILE = "ts:src/adapters/cache/repo-cache.ts#repoCacheFile";
const CACHE_BASE = "ts:src/adapters/cache/repo-cache.ts#codegraphCacheBase";
const EXPORT_MOD = "ts:src/core/graph/export.ts";
const PANEL_MOD = "ts:src/adapters/surfaces/webview/panel.ts";

// Agent grounding notes are Markdown (bold/code/links + inline Mermaid): the
// detail panel renders them through the shared <AgentMarkdown> (T13.3).
const noteBody = [
  "The **shared cache-path root**. Every per-repo store — enrichment, diagrams, docs,",
  "and overlays — derives its file from `codegraphCacheBase`, so the MCP writer and the",
  "board reader meet at one place.",
  "",
  "```mermaid",
  "flowchart TD",
  '  base["codegraphCacheBase"] --> enrich["enrichment"]',
  '  base --> diagrams["diagrams"]',
  '  base --> docs["docs"]',
  '  base --> overlays["overlays"]',
  "```",
  "",
  "Home-anchored on purpose: the MCP launcher strips `TMPDIR`, so `os.tmpdir()` would",
  "split the two processes.",
].join("\n");

function main(): void {
  const raw = fs.readFileSync(FIXTURE, "utf8");
  const snap = JSON.parse(raw) as GraphSnapshot;
  const addresses = new Set(snap.nodes.map((n) => n.address));
  const hasEdge = (from: string, to: string, type: string): boolean =>
    snap.edges.some((e) => e.from === from && e.to === to && e.type === type);

  const require = (...addrs: string[]): void => {
    const missing = addrs.filter((a) => !addresses.has(a));
    if (missing.length) throw new Error(`fixture is missing seed anchors: ${missing.join(", ")}`);
  };
  require(CACHE_FILE, CACHE_BASE, EXPORT_MOD, PANEL_MOD);
  if (!hasEdge(CACHE_FILE, CACHE_BASE, "calls")) {
    throw new Error(`fixture is missing the seed edge ${CACHE_FILE} --calls--> ${CACHE_BASE}`);
  }

  const results = [
    validateNote({ anchor: { on: "node", address: CACHE_FILE }, body: noteBody, updatedAt: STAMP }),
    validateMark({ address: CACHE_FILE, mark: "hotspot", severity: "warn", label: "shared by 4 stores", updatedAt: STAMP }),
    validateMark({ address: EXPORT_MOD, mark: "todo", label: "carry overlays in the host read-path", updatedAt: STAMP }),
    validateGroup({ label: "Snapshot pipeline", members: [EXPORT_MOD, PANEL_MOD], updatedAt: STAMP }),
    validateNote({
      anchor: { on: "edge", from: CACHE_FILE, to: CACHE_BASE, type: "calls" },
      body: "Each store hashes its repo root through this call to get a stable directory.",
      updatedAt: STAMP,
    }),
  ];

  const overlays: Overlay[] = results.map((r) => {
    if (!r.ok) throw new Error(`bad seed overlay: ${r.error}`);
    return r.overlay;
  });

  const next: GraphSnapshot = { ...snap, overlays };
  fs.writeFileSync(FIXTURE, JSON.stringify(next));
  process.stdout.write(`seeded ${overlays.length} overlays into ${path.relative(process.cwd(), FIXTURE)}\n`);
}

main();
