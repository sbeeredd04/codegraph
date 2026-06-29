import { test, expect, type Page } from "@playwright/test";

// FR-57b (3D convex-hull package regions). "Colour by package" (FR-57) tints every
// node by its package; this overlay draws each package's boundary — a padded convex
// hull around its members — so a monorepo reads as enclosed territories. This drives
// the real surface: boot a 2-package snapshot, switch to 3D, toggle "Colour", and
// assert the region polygons appear on, and disappear off. The hull math is unit-
// reasoned in lib/package-regions-3d; this proves the wiring + render path.

// Two flat packages — `web/*` and `api/*` — four files each (a hull needs ≥3 points).
const TWO_PKG = {
  version: 1,
  root: "two-pkg",
  nodeCount: 8,
  edgeCount: 7,
  nodes: [
    { address: "m:web/app.ts", kind: "module", name: "app.ts", location: { file: "web/app.ts", line: 0, character: 0 } },
    { address: "m:web/router.ts", kind: "module", name: "router.ts", location: { file: "web/router.ts", line: 0, character: 0 } },
    { address: "m:web/view.ts", kind: "module", name: "view.ts", location: { file: "web/view.ts", line: 0, character: 0 } },
    { address: "m:web/store.ts", kind: "module", name: "store.ts", location: { file: "web/store.ts", line: 0, character: 0 } },
    { address: "m:api/server.ts", kind: "module", name: "server.ts", location: { file: "api/server.ts", line: 0, character: 0 } },
    { address: "m:api/routes.ts", kind: "module", name: "routes.ts", location: { file: "api/routes.ts", line: 0, character: 0 } },
    { address: "m:api/db.ts", kind: "module", name: "db.ts", location: { file: "api/db.ts", line: 0, character: 0 } },
    { address: "m:api/auth.ts", kind: "module", name: "auth.ts", location: { file: "api/auth.ts", line: 0, character: 0 } },
  ],
  edges: [
    { from: "m:web/app.ts", to: "m:web/router.ts", type: "depends-on" },
    { from: "m:web/router.ts", to: "m:web/view.ts", type: "depends-on" },
    { from: "m:web/app.ts", to: "m:web/store.ts", type: "depends-on" },
    { from: "m:web/app.ts", to: "m:api/server.ts", type: "depends-on" },
    { from: "m:api/server.ts", to: "m:api/routes.ts", type: "depends-on" },
    { from: "m:api/routes.ts", to: "m:api/db.ts", type: "depends-on" },
    { from: "m:api/server.ts", to: "m:api/auth.ts", type: "depends-on" },
  ],
};

async function bootLiveSnapshot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => undefined,
    });
  });
  await page.goto("/");
  await expect(page.getByText(/Loading dataset/i)).toBeVisible();
  await page.evaluate((snap) => {
    window.postMessage({ type: "codegraph:snapshot", snapshot: snap }, "*");
  }, TWO_PKG);
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

/** How many package-region polygons are currently painted on the 3D surface. */
async function regionPolygonCount(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[data-surface="3d"] svg[data-layer="regions"] polygon').length,
  );
}

test("3D package regions appear when colour-by-package is on and clear when off", async ({ page }) => {
  await bootLiveSnapshot(page);

  // Switch to the 3D surface; its region layer mounts (empty until colour is on).
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  expect(await regionPolygonCount(page)).toBe(0);

  // Turn on "Colour by package" — each of the two packages gets a hull (≥3 members),
  // so two region polygons should paint over the field.
  await page.getByRole("button", { name: "Colour" }).click();
  await expect.poll(async () => regionPolygonCount(page), { timeout: 15_000 }).toBe(2);

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/fr57b-regions3d.png",
  });

  // Turn it back off — the overlay clears (root files were never enclosed; packages
  // go back to the kind colouring with no hulls).
  await page.getByRole("button", { name: "Colour" }).click();
  await expect.poll(async () => regionPolygonCount(page), { timeout: 15_000 }).toBe(0);
});
