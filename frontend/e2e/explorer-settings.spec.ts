import { test, expect, type Page } from "@playwright/test";

// FR-51: the Settings surface — the explorer's persisted board preferences. These
// assert it opens from the toolbar, that "Open settings" is also reachable through
// the SAME ⌘⇧P action catalogue (single source of truth, never a fork), and the
// load-bearing behaviour: changing the default surface drives the board live AND
// survives a reload (the board boots straight into the persisted 3D surface).

// The 2D Sigma surface exposes its graph on the container's __sigma hook once
// booted; waiting on it proves the Explorer (and its toolbar) mounted.
async function waitForBoot(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForBoot(page);
});

test("opens from the toolbar (FR-51)", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Default surface" })).toBeVisible();
});

test('"Open settings" is reachable from the ⌘⇧P action palette — single source of truth (FR-51)', async ({
  page,
}) => {
  await page.keyboard.press("Control+Shift+P");
  const palette = page.getByRole("dialog", { name: "Run an action" });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder("Run a command…").fill("settings");
  await palette.getByRole("option", { name: /Open settings/i }).click();

  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("changing the default surface drives the board and persists across reload (FR-51)", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("group", { name: "Default surface" }).getByRole("button", { name: "3D" }).click();

  // The change drives the board immediately through the SAME setter the toolbar
  // uses — the 3D surface mounts and the toolbar's 3d segment is now pressed.
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await expect(page.getByRole("button", { name: "3d", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Persisted: after a reload the board seeds from localStorage and boots straight
  // into the 3D surface (so we wait on the 3D canvas, not the 2D __sigma hook).
  await page.reload();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "3d", exact: true })).toHaveAttribute("aria-pressed", "true");

  // And the saved value is reflected back in the panel.
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Default surface" }).getByRole("button", {
      name: "3D",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});
