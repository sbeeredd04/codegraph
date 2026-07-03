import { test, expect } from "@playwright/test";

// FR-17 — the 2D⇄3D render-mode toggle. The same graph renders through a
// swappable surface: the 2D Sigma canvas or the dependency-free 3D canvas. This
// proves the toggle mounts each surface and that the 2D-only Orphans lens is
// correctly withheld in 3D (Trace, FR-61, now works on both surfaces). The 3D
// layout/projection math itself is unit-tested in layout3d.test.ts.

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

  // Orphans stays 2D-only in 3D — but as an aria-disabled control that still explains
  // WHY on hover (T8.9), not a dead native-disabled button. Trace works on both.
  const orphans = page.getByRole("button", { name: /Orphans/ });
  await expect(orphans).toHaveAttribute("aria-disabled", "true");
  await expect(orphans).toHaveAttribute("title", /2D-only/);
  await expect(page.getByRole("button", { name: "Trace" })).toBeEnabled();

  // Switch back — the 3D surface unmounts, the 2D canvas returns.
  await to2d.click();
  await expect(page.locator('[data-surface="3d"]')).toHaveCount(0);
  await expect(to2d).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("canvas").first()).toBeVisible();
});

// T8.9 — a 2D-only control in 3D must read as intentionally disabled (a discoverable
// reason on hover, kept reachable by aria-disabled instead of native `disabled`), and
// clicking it must be an inert no-op — never a dead grey button with no explanation.
test("2D-only controls stay reachable + explain themselves when disabled in 3D", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();

  const folders = page.getByRole("button", { name: "Folders" });
  // aria-disabled (not native `disabled`) → the button still receives hover in the
  // browser, so its reason tooltip is discoverable; the reason names the constraint.
  await expect(folders).toHaveAttribute("aria-disabled", "true");
  await expect(folders).toHaveAttribute("title", /Folders is a 2D-only view/);

  // The onClick is guarded: even forcing a click past the aria-disabled state (which
  // Playwright otherwise treats as un-actionable) never toggles it on.
  await folders.click({ force: true });
  await expect(folders).toHaveAttribute("aria-pressed", "false");
});
