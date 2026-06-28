import { test, expect } from "@playwright/test";

// FR-17 — the 2D⇄3D render-mode toggle. The same graph renders through a
// swappable surface: the 2D Sigma canvas or the dependency-free 3D canvas. This
// proves the toggle mounts each surface and that the 2D-only lenses (orphans,
// trace) are correctly withheld in 3D. The 3D layout/projection math itself is
// unit-tested in src/adapters/surfaces/webview/layout3d.test.ts.

test("toggles between the 2D and 3D render surfaces", async ({ page }) => {
  await page.goto("/");

  // The 2D surface renders first; the 3D surface is not mounted yet.
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator('[data-surface="3d"]')).toHaveCount(0);

  // Switch to 3D — its canvas mounts and the toggle reflects the active mode.
  const to3d = page.getByRole("button", { name: "3d", exact: true });
  const to2d = page.getByRole("button", { name: "2d", exact: true });
  await to3d.click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await expect(to3d).toHaveAttribute("aria-pressed", "true");
  await expect(to2d).toHaveAttribute("aria-pressed", "false");

  // The 2D-only lenses are disabled in 3D so they can't be armed with no effect.
  await expect(page.getByRole("button", { name: "Trace" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Orphans/ })).toBeDisabled();

  // Switch back — the 3D surface unmounts, the 2D canvas returns.
  await to2d.click();
  await expect(page.locator('[data-surface="3d"]')).toHaveCount(0);
  await expect(to2d).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("canvas").first()).toBeVisible();
});
