import { test, expect, type Page } from "@playwright/test";

// FR-47: the 3D surface's camera controls. Drives the real surface on the dev
// server and reads the dev-only __cameraState snapshot (tree-shaken from prod) to
// assert Reset returns the default pose and Fit reframes the whole graph — without
// pixel-reading WebGL. Mirrors the __overlay3d / __controller hook pattern. Orbit
// and zoom are exercised through real mouse input (Chromium synthesises the
// pointer/wheel events the surface listens for).

interface Cam {
  radius: number;
  theta: number;
  phi: number;
  tx: number;
  ty: number;
  tz: number;
}

async function switchTo3D(page: Page): Promise<void> {
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(
            (document.querySelector('[data-surface="3d"]') as (HTMLElement & { __cameraState?: unknown }) | null)
              ?.__cameraState,
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function cameraState(page: Page): Promise<Cam> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-surface="3d"]') as
      | (HTMLElement & { __cameraState?: () => Cam })
      | null;
    return el!.__cameraState!();
  });
}

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-surface="3d"] canvas').boundingBox();
  if (!box) throw new Error("no 3d canvas");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await switchTo3D(page);
});

test("Reset view returns the camera to its default framing (FR-47)", async ({ page }) => {
  const d = await cameraState(page);
  const { x, y } = await canvasCenter(page);

  // Orbit: a no-modifier drag rotates the camera — azimuth must change.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 40, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await cameraState(page)).theta - d.theta), { timeout: 4_000 })
    .toBeGreaterThan(0.05);

  // Zoom: the wheel grows the orbit radius.
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => (await cameraState(page)).radius, { timeout: 4_000 })
    .toBeGreaterThan(d.radius * 1.2);

  // Reset eases angle + zoom + centre back to the defaults.
  await page.getByRole("button", { name: "Reset camera view" }).click();
  await expect
    .poll(
      async () => {
        const c = await cameraState(page);
        return (
          Math.abs(c.radius - d.radius) < 1 &&
          Math.abs(c.theta - d.theta) < 0.02 &&
          Math.abs(c.phi - d.phi) < 0.02 &&
          Math.hypot(c.tx, c.ty, c.tz) < 1
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
});

test("Fit to graph reframes the whole graph from any zoom (FR-47)", async ({ page }) => {
  const d = await cameraState(page);
  const { x, y } = await canvasCenter(page);

  // Zoom way in so Fit has to pull back to enclose the graph.
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -700);
  await page.mouse.wheel(0, -700);
  await expect
    .poll(async () => (await cameraState(page)).radius, { timeout: 4_000 })
    .toBeLessThan(d.radius * 0.7);

  // Fit recenters the target at the centroid and frames the bounding sphere — for a
  // landscape viewport that lands close to the default distance.
  await page.getByRole("button", { name: "Fit graph to view" }).click();
  await expect
    .poll(
      async () => {
        const c = await cameraState(page);
        return Math.hypot(c.tx, c.ty, c.tz) < 1 && Math.abs(c.radius - d.radius) < d.radius * 0.3;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
});
