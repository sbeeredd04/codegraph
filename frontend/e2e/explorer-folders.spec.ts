import { test, expect, type Page } from "@playwright/test";

// FR-26 — folder clustering. Toggling "Folders" re-places the graph so nodes of
// the same source directory gather into their own region. The placement math is
// pure + unit-tested (src/adapters/surfaces/webview/folder-layout.test.ts); here
// we prove the toggle actually moves nodes and that toggling back restores the
// force layout exactly — read from the raw graph coords (camera-independent) via
// the dev __sigma hook. Also captures a screenshot of the clustered map.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

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

type Positions = Record<string, [number, number]>;

function positions(page: Page): Promise<Positions> {
  return page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { getGraph(): { forEachNode(cb: (id: string, a: Record<string, unknown>) => void): void } };
    };
    const out: Record<string, [number, number]> = {};
    el.__sigma.getGraph().forEachNode((id, a) => {
      out[id] = [a.x as number, a.y as number];
    });
    return out;
  });
}

function maxDelta(a: Positions, b: Positions): number {
  let m = 0;
  for (const id of Object.keys(a)) {
    const p = a[id];
    const q = b[id];
    if (p && q) m = Math.max(m, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return m;
}

test("FR-26: Folders clusters the graph by directory and restores cleanly", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  const base = await positions(page);

  // Cluster on — nodes move to their folder regions.
  await page.getByRole("button", { name: "Folders" }).click();
  await expect
    .poll(async () => maxDelta(await positions(page), base), { timeout: 5_000 })
    .toBeGreaterThan(1);
  await page.screenshot({ path: `${SHOT}/folders-clustered-2d.png` });

  // Cluster off — the force layout is restored exactly (the swap, not a relayout).
  await page.getByRole("button", { name: "Folders" }).click();
  await expect
    .poll(async () => maxDelta(await positions(page), base), { timeout: 5_000 })
    .toBeLessThan(1e-6);
});

test("FR-26 follow-up: clustering draws folder hull outlines + name labels", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // The territory layer is always mounted (pointer-through SVG over the canvas)
  // but empty until clustering is on.
  const overlay = page.getByTestId("folder-overlay");
  await expect(overlay).toBeAttached();
  await expect(overlay.locator(".cg-folder-label")).toHaveCount(0);

  // Cluster on — folder name labels + at least one hull outline appear.
  await page.getByRole("button", { name: "Folders" }).click();
  await expect
    .poll(async () => overlay.locator(".cg-folder-label").count(), { timeout: 5_000 })
    .toBeGreaterThan(0);
  expect(await overlay.locator(".cg-folder-hull").count()).toBeGreaterThan(0);

  // Labels are decluttered: only the largest folder regions are named (capped),
  // and every label is non-empty — so a dense 40-folder map stays readable.
  const labels = await overlay.locator(".cg-folder-label").allTextContents();
  expect(labels.length).toBeLessThanOrEqual(14); // MAX_REGIONS — biggest folders only
  expect(labels.every((t) => t.trim().length > 0)).toBe(true);
  await page.screenshot({ path: `${SHOT}/folders-hulls-2d.png` });

  // Cluster off — the territory layer clears (no orphaned outlines/labels).
  await page.getByRole("button", { name: "Folders" }).click();
  await expect
    .poll(async () => overlay.locator(".cg-folder-label").count(), { timeout: 5_000 })
    .toBe(0);
  expect(await overlay.locator(".cg-folder-hull").count()).toBe(0);
});
