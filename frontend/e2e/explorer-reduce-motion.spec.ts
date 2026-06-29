import { test, expect, type Page } from "@playwright/test";

// FR-51-deferred: the "Motion" override in Settings. The 3D camera tweens (FR-47)
// honour the OS prefers-reduced-motion by default ("Auto"), but a user can force the
// behaviour either way. The deterministic tell: under reduced motion `tweenTo`
// settles SYNCHRONOUSLY (the pose jumps in the same tick), while animated it only
// changes on the next rAF — so reading __cameraState right after a controller call,
// in the same evaluate, distinguishes the two without timing flakiness.
//
// Two directions, each proving the override beats the OS, not just mirrors it:
//   • override "Reduced" with OS = no-preference  → snaps (override forces calm)
//   • override "Full" with OS = reduce             → animates (override forces motion)

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

/** Pick a Motion override in the Settings modal, then close it. */
async function setMotion(page: Page, label: "Auto" | "Reduced" | "Full"): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).click();
  const motion = page.getByRole("group", { name: "Motion" });
  await expect(motion).toBeVisible();
  await motion.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
}

/** A no-modifier drag at the canvas centre — orbits the camera (changes azimuth). */
async function orbitAway(page: Page): Promise<void> {
  const box = await page.locator('[data-surface="3d"] canvas').boundingBox();
  if (!box) throw new Error("no 3d canvas");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy, { steps: 4 });
  await page.mouse.up();
}

/** Read theta before a resetCamera(), then synchronously after it (same tick). */
async function resetAndReadTheta(page: Page): Promise<{ before: number; afterSync: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-surface="3d"]') as HTMLElement & {
      __cameraState: () => Cam;
      __controller: { resetCamera: () => void };
    };
    const before = el.__cameraState().theta;
    el.__controller.resetCamera();
    const afterSync = el.__cameraState().theta; // same tick — settled iff reduced
    return { before, afterSync };
  });
}

async function theta(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.querySelector('[data-surface="3d"]') as HTMLElement & { __cameraState: () => Cam }).__cameraState()
        .theta,
  );
}

test("override 'Reduced' snaps the camera instantly even when the OS allows motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await switchTo3D(page);
  await setMotion(page, "Reduced");

  await orbitAway(page);
  const { before, afterSync } = await resetAndReadTheta(page);

  // Reset settled in the same tick: theta jumped back to the default pose immediately.
  expect(Math.abs(afterSync - before)).toBeGreaterThan(0.3);
  await expect.poll(async () => theta(page), { timeout: 2000 }).toBeCloseTo(0.7, 1);
});

test("override 'Full' animates the camera even when the OS asks to reduce motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await switchTo3D(page);
  await setMotion(page, "Full");

  await orbitAway(page);
  const { before, afterSync } = await resetAndReadTheta(page);

  // Animated: nothing moved synchronously — the reset only steps on the next frame.
  expect(afterSync).toBeCloseTo(before, 5);
  // …but it DOES animate to the default pose over the following frames.
  await expect.poll(async () => theta(page), { timeout: 2000 }).toBeCloseTo(0.7, 1);
});
