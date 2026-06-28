import { test, expect, type Page } from "@playwright/test";

// FR-37 (Epic 19): the agent's overlays render on the board. The codegraph
// self-portrait fixture is seeded (scripts/seed-sample-overlays.ts) with a note,
// typed markers, and a group on real nodes; selecting a seeded node must surface
// them in the detail panel. Runs against the dev server so the `__sigma` hook is
// present (see playwright.config.ts).

const SEEDED = "ts:src/adapters/cache/repo-cache.ts#repoCacheFile";

// Wait until the *codegraph* dataset has actually swapped in. A bare `order > 0`
// poll is not enough: the default trpc graph also has order>0, so it can return
// mid-swap on the wrong dataset (whose nodes carry none of these `ts:src/...`
// addresses). Polling for a known codegraph node gates on the real swap instead.
async function waitForNode(page: Page, address: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((addr) => {
          const el = document.querySelector("div.absolute.inset-0") as
            | (HTMLElement & { __sigma?: { getGraph(): { hasNode(id: string): boolean } } })
            | null;
          const sigma = el?.__sigma;
          return sigma ? sigma.getGraph().hasNode(addr) : false;
        }, address),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Click a specific node by address via the real Sigma clickNode event. */
async function clickNode(page: Page, address: string): Promise<boolean> {
  return page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & { __sigma?: { getGraph(): { hasNode(id: string): boolean }; emit(ev: string, p: unknown): void } })
      | null;
    const sigma = el?.__sigma;
    if (!sigma || !sigma.getGraph().hasNode(addr)) return false;
    sigma.emit("clickNode", { node: addr });
    return true;
  }, address);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Dataset").selectOption("codegraph");
  // Gate on a real codegraph node so every test starts from the settled dataset.
  await waitForNode(page, SEEDED);
});

test("a seeded node surfaces its note and mark badges in the detail panel", async ({ page }) => {
  expect(await clickNode(page, SEEDED)).toBe(true);

  const body = page.getByTestId("detail-body");
  await expect(body).toBeVisible();

  // The agent's note renders as escaped prose.
  const note = body.getByTestId("node-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("shared cache-path root");

  // Its typed marker shows as a badge, with the severity suffix.
  const marks = body.getByTestId("node-marks");
  await expect(marks).toContainText("hotspot");
  await expect(marks).toContainText("warn");
});

test("a node in a seeded group lists its group membership", async ({ page }) => {
  // The snapshot exporter is a member of the 'Snapshot pipeline' group.
  expect(await clickNode(page, "ts:src/core/graph/export.ts")).toBe(true);

  const groups = page.getByTestId("detail-body").getByTestId("node-groups");
  await expect(groups).toBeVisible();
  await expect(groups).toContainText("Snapshot pipeline");
  // It also carries a todo marker.
  await expect(page.getByTestId("detail-body").getByTestId("node-marks")).toContainText("todo");
});

test("a node with no overlays renders no overlay section", async ({ page }) => {
  // codegraphCacheBase is the *target* of the seeded edge note but carries no
  // node-anchored overlay of its own.
  expect(await clickNode(page, "ts:src/adapters/cache/repo-cache.ts#codegraphCacheBase")).toBe(true);
  await expect(page.getByTestId("detail-body")).toBeVisible();
  await expect(page.getByTestId("node-overlays")).toHaveCount(0);
});
