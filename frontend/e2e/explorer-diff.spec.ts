import { test, expect, type Page } from "@playwright/test";

// FR-69 — the live graph-diff lens. Arming "Diff" pins a baseline snapshot and tints
// what changed in the live graph: added = green, removed = red (gone, panel-only),
// changed = amber, moved = violet. The colouring is driven by the SAME pure-core diff
// the extension uses (src/core/graph/diff.ts → changesFromDelta) feeding the Sigma
// nodeReducer (2D) and the 3D draw loop, so we assert it deterministically through
// getNodeDisplayData (2D) and the __overlay3d hook (3D) — no pixel reading.
//
// The web plane has no live snapshot channel (subscribeToSnapshot only fires inside the
// VS Code webview), so we drive the lens through the dev-only `__diff` hook: read the
// live snapshot, craft a baseline that differs in exactly one of each kind, inject it.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

// Must match lib/diff-palette.ts + the surfaces' recede constant.
const ADDED = "#3fb950";
const CHANGED = "#e3b341";
const MOVED = "#a371f7";
const DIM = "#39414f"; // ORPHAN_DIM_NODE — off-lens recede

interface SnapNode {
  readonly address: string;
  readonly kind: string;
  readonly name: string;
  readonly location: unknown;
}
interface SnapEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}
interface Snapshot {
  readonly nodes: SnapNode[];
  readonly edges: SnapEdge[];
}
interface Picks {
  readonly M: string; // moved  → violet
  readonly A: string; // added  → green
  readonly C: string; // changed → amber
  readonly U: string; // untouched → dim
}

async function waitForGraph(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector("div.absolute.inset-0") as
            | (HTMLElement & { __sigma?: { getGraph(): { order: number } } })
            | null;
          return el?.__sigma ? el.__sigma.getGraph().order : 0;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const el = document.querySelector("[data-explorer]") as
      | (HTMLElement & { __diff?: { snapshot(): Snapshot } })
      | null;
    return el!.__diff!.snapshot();
  });
}

/** Craft a baseline differing from the live snapshot in exactly one of each change kind.
 * Picks are chosen so the diff stays pollution-free: M and A are orphans (no inbound),
 * so renaming M and deleting A never flips an unrelated node's outbound set to "changed".
 * - MOVED:   rename a high-outbound orphan M → an OLD address (name + outbound match →
 *            score ≥ 3 → the diff re-identifies it as a move to M, not delete+create).
 * - ADDED:   drop a second orphan A from the baseline → it reads as added in the live graph.
 * - CHANGED: give a third node C an extra outbound edge in the baseline → its edge-set
 *            differs → changed.
 * - REMOVED: add a ghost node only to the baseline → it's gone from the live graph. */
function craftBaseline(snap: Snapshot): { picks: Picks; baseline: Snapshot } {
  const inbound = new Set(snap.edges.map((e) => e.to));
  const outBy = new Map<string, Set<string>>();
  for (const e of snap.edges) {
    if (!outBy.has(e.from)) outBy.set(e.from, new Set());
    outBy.get(e.from)!.add(e.to);
  }
  const addrs = snap.nodes.map((n) => n.address);
  const orphans = addrs.filter((a) => !inbound.has(a));
  const M = orphans
    .filter((a) => (outBy.get(a)?.size ?? 0) >= 1)
    .sort((a, b) => outBy.get(b)!.size - outBy.get(a)!.size)[0];
  const A = orphans.find((a) => a !== M)!;
  const C = addrs.find((a) => a !== M && a !== A)!;
  const U = addrs.find((a) => a !== M && a !== A && a !== C)!;

  const OLD = "cg-diff::moved-old";
  const GHOST = "cg-diff::removed-ghost";
  const EXTRA = "cg-diff::changed-extra";
  const edgeType = snap.edges[0].type;

  const nodes: SnapNode[] = [];
  for (const n of snap.nodes) {
    if (n.address === A) continue; // ADDED: A absent from the baseline
    if (n.address === M) {
      nodes.push({ ...n, address: OLD }); // MOVED: same node at the OLD address
      continue;
    }
    nodes.push(n);
  }
  // REMOVED: a ghost present only in the baseline (unique name + no edges → no match).
  nodes.push({ ...snap.nodes[0], address: GHOST, name: "cgDiffRemovedGhost" });

  const edges: SnapEdge[] = [];
  for (const e of snap.edges) {
    if (e.from === A || e.to === A) continue; // drop A's incident edges with A
    edges.push({ ...e, from: e.from === M ? OLD : e.from, to: e.to === M ? OLD : e.to });
  }
  edges.push({ from: C, to: EXTRA, type: edgeType }); // CHANGED: C gains an outbound edge

  return { picks: { M, A, C, U }, baseline: { nodes, edges } };
}

function injectBaseline(page: Page, baseline: Snapshot): Promise<void> {
  return page.evaluate((b) => {
    const el = document.querySelector("[data-explorer]") as HTMLElement & {
      __diff: { setBaseline(s: Snapshot): void };
    };
    el.__diff.setBaseline(b);
  }, baseline);
}

/** Post-reducer 2D display data for a node (label + the colour Sigma will paint). */
function read2d(page: Page, address: string): Promise<{ label: string; color: string }> {
  return page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & {
          __sigma?: { getNodeDisplayData(id: string): { label?: string; color?: string } | undefined };
        })
      | null;
    const d = el!.__sigma!.getNodeDisplayData(addr);
    return { label: d?.label ?? "", color: d?.color ?? "" };
  }, address);
}

async function armDiff(page: Page, baseline: Snapshot): Promise<void> {
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.getByTestId("diff-panel")).toBeVisible();
  await injectBaseline(page, baseline);
}

test("FR-69: the 2D diff lens tints added/changed/moved, recedes the rest, panel ranks the changes", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);

  const snap = await readSnapshot(page);
  const { picks, baseline } = craftBaseline(snap);
  expect(picks.M, "dataset should have an orphan with outbound edges").toBeTruthy();
  expect(picks.A, "dataset should have a second orphan").toBeTruthy();
  expect(new Set([picks.M, picks.A, picks.C, picks.U]).size).toBe(4);

  await armDiff(page, baseline);

  // The changed node lands amber once the delta is computed; assert all four kinds.
  await expect.poll(async () => (await read2d(page, picks.C)).color).toBe(CHANGED);
  expect((await read2d(page, picks.A)).color).toBe(ADDED);
  expect((await read2d(page, picks.M)).color).toBe(MOVED);
  // A changed node keeps its label so the user can read what moved/changed.
  expect((await read2d(page, picks.A)).label).not.toBe("");
  // An untouched node recedes (dimmed, label blanked) — the lens spotlights the change.
  const u = await read2d(page, picks.U);
  expect(u.color).toBe(DIM);
  expect(u.label).toBe("");

  // The panel mirrors the delta: header total + the +1/−1/~1/→1 deltaCounts summary.
  await expect(page.getByTestId("diff-count")).toHaveText("4");
  await expect(page.getByTitle("1 added")).toBeVisible();
  await expect(page.getByTitle("1 removed")).toBeVisible();
  await expect(page.getByTitle("1 changed")).toBeVisible();
  await expect(page.getByTitle("1 moved")).toBeVisible();

  // The ranked feed lists every change, including the removed ghost (gone from the
  // board, so panel-only and inert — no jump button), keyed by data-change.
  await expect(page.getByTestId("diff-feed")).toBeVisible();
  await expect(page.getByTestId("diff-row")).toHaveCount(4);
  const removedRow = page.locator('[data-testid="diff-row"][data-change="removed"]');
  await expect(removedRow).toContainText("cgDiffRemovedGhost");
  await expect(removedRow.locator("button")).toHaveCount(0);

  // The added row jumps to the node (FR-25 focus) → the detail panel opens for it
  // (mounts only on selection; docked by default → the always-present detail body).
  await page.locator('[data-testid="diff-row"][data-change="added"] button').click();
  await expect(page.getByTestId("detail-body")).toBeVisible();

  await page.screenshot({ path: `${SHOT}/diff-2d.png` });
});

// 3D PARITY — the same per-node change map feeds the 3D draw loop via diffColorOf folded
// into drawColorOf; the dev `__overlay3d` hook routes through the SAME drawColorOf the
// WebGL instances paint, so we assert the diff hues deterministically.
async function switchTo3D(page: Page): Promise<void> {
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
}

function overlay3d(page: Page, address: string): Promise<string | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector('[data-surface="3d"]') as
      | (HTMLElement & { __overlay3d?: (a: string) => string | null })
      | null;
    return el?.__overlay3d ? el.__overlay3d(addr) : null;
  }, address);
}

test("FR-69: the 3D surface paints the same added/changed/moved diff hues", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  const snap = await readSnapshot(page);
  const { picks, baseline } = craftBaseline(snap);
  expect(new Set([picks.M, picks.A, picks.C, picks.U]).size).toBe(4);

  // Arm the lens on 2D (the __diff hook lives on the explorer shell, surface-agnostic),
  // then switch to the WebGL surface — diffMode + baseline persist across the switch.
  await armDiff(page, baseline);
  await switchTo3D(page);

  // The scene builds, then the changed node resolves to amber via drawColorOf.
  await expect.poll(() => overlay3d(page, picks.C)).toBe(CHANGED);
  expect(await overlay3d(page, picks.A)).toBe(ADDED);
  expect(await overlay3d(page, picks.M)).toBe(MOVED);
  // The untouched node is NOT painted a diff hue.
  expect(await overlay3d(page, picks.U)).not.toBe(CHANGED);
  expect(await overlay3d(page, picks.U)).not.toBe(ADDED);
  expect(await overlay3d(page, picks.U)).not.toBe(MOVED);

  await page.screenshot({ path: `${SHOT}/diff-3d.png` });
});
