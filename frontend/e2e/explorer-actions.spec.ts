import { test, expect, type Page } from "@playwright/test";

// FR-50: the ⌘⇧P action palette — a command-of-ACTIONS surface distinct from the
// ⌘K node search. These assert it opens on the shortcut, is visibly its own thing
// (a different dialog + placeholder), fuzzy-filters, and that RUNNING an action
// actually drives the board (single source of truth with the toolbar) — proven via
// the same view state the toolbar exposes. State-awareness is checked too: a
// 3D-only camera action is disabled while the 2D surface is mounted.

const ACTIONS = "Control+Shift+P";

async function openActionPalette(page: Page) {
  await page.keyboard.press(ACTIONS);
  const dialog = page.getByRole("dialog", { name: "Run an action" });
  await expect(dialog).toBeVisible();
  return dialog;
}

// The 2D Sigma surface exposes its graph on the container's __sigma hook once
// booted; waiting on it proves the Explorer (and its global shortcut listener)
// is mounted.
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

test("⌘⇧P opens the action palette, distinct from ⌘K, and filters (FR-50)", async ({ page }) => {
  const dialog = await openActionPalette(page);
  // It is its OWN surface — a "Run a command…" action palette, not the node search.
  await expect(dialog.getByPlaceholder("Run a command…")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Search nodes" })).toHaveCount(0);

  // Fuzzy filter narrows to the matching action.
  await dialog.getByPlaceholder("Run a command…").fill("switch 3d");
  await expect(dialog.getByRole("option", { name: /Switch to 3D/i })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Reset panel layout/i })).toHaveCount(0);
});

test("running an action drives the board — Switch to 3D (FR-50)", async ({ page }) => {
  const dialog = await openActionPalette(page);
  await dialog.getByPlaceholder("Run a command…").fill("switch 3d");
  await dialog.getByPlaceholder("Run a command…").press("Enter");

  // The palette closed and the board is now the real 3D surface.
  await expect(page.getByRole("dialog", { name: "Run an action" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "3d", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
});

test("running a panel action opens it — Open knowledge diagrams (FR-50)", async ({ page }) => {
  const dialog = await openActionPalette(page);
  await dialog.getByPlaceholder("Run a command…").fill("diagrams");
  await dialog.getByRole("option", { name: /Open knowledge diagrams/i }).click();

  await expect(page.getByRole("dialog", { name: "Run an action" })).toHaveCount(0);
  // The toolbar's Diagrams toggle now reflects the open drawer — same state the
  // action drove, proving the palette reuses the toolbar's handler (located by its
  // title to disambiguate from the drawer's own "Collapse Diagrams" control).
  await expect(page.locator('button[title="Agent-authored knowledge diagrams"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("actions mirror live state — a 3D camera action is gated in 2D (FR-50)", async ({ page }) => {
  // In the default 2D surface, "Reset camera view" exists but is disabled.
  let dialog = await openActionPalette(page);
  await dialog.getByPlaceholder("Run a command…").fill("reset camera");
  await expect(dialog.getByRole("option", { name: /Reset camera view/i })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Run an action" })).toHaveCount(0);

  // Switch to 3D, and the same action becomes enabled.
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  dialog = await openActionPalette(page);
  await dialog.getByPlaceholder("Run a command…").fill("reset camera");
  await expect(dialog.getByRole("option", { name: /Reset camera view/i })).toHaveAttribute("aria-disabled", "false");
});
