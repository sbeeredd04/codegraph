import { test, expect, type Page } from "@playwright/test";

// FR-49: the ⌘Space command center — a unified launcher that UNIONS the ⌘K node
// search and the ⌘⇧P action palette. These assert it opens on its own shortcut
// (distinct from the other two surfaces), that typing surfaces BOTH a matching
// node and a matching action (grouped), and that choosing either kind actually
// drives the board — a node selection opens the detail panel, an action flips the
// surface — proving it reuses the SAME handlers, never a fork.

const CENTER = "Control+Space";

async function openCommandCenter(page: Page) {
  await page.keyboard.press(CENTER);
  const dialog = page.getByRole("dialog", { name: "Command center" });
  await expect(dialog).toBeVisible();
  return dialog;
}

// The 2D Sigma surface exposes its graph on the container's __sigma hook once
// booted; waiting on it proves the Explorer (and its launcher shortcuts) mounted.
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

test("⌘Space opens the command center, distinct from ⌘K and ⌘⇧P (FR-49)", async ({ page }) => {
  const dialog = await openCommandCenter(page);
  // Its own surface — a unified launcher, not the node-only search or action palette.
  await expect(dialog.getByPlaceholder("Search nodes, run actions…")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Search nodes" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Run an action" })).toHaveCount(0);
});

test("typing surfaces both a matching node and a matching action, grouped (FR-49)", async ({ page }) => {
  const dialog = await openCommandCenter(page);
  await dialog.getByPlaceholder("Search nodes, run actions…").fill("re");
  // The group headers render only when that group is non-empty, so both visible
  // means a node AND an action matched. (Exact match avoids the "Search nodes"
  // action label and the action section tags.)
  await expect(dialog.getByText("Nodes", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Actions", { exact: true })).toBeVisible();
  // A concrete action that always exists and matches "re".
  await expect(dialog.getByRole("option", { name: /Reset camera view/i })).toBeVisible();
});

test("choosing a node selects it and opens the detail panel (FR-49)", async ({ page }) => {
  const dialog = await openCommandCenter(page);
  await dialog.getByPlaceholder("Search nodes, run actions…").fill("re");
  // Nodes are listed first, so the top option is a graph node — choosing it routes
  // through the SAME jump-to-node handler ⌘K uses (select + camera focus).
  await dialog.getByRole("option").first().click();

  await expect(page.getByRole("dialog", { name: "Command center" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
});

test("choosing an action drives the board — Switch to 3D (FR-49)", async ({ page }) => {
  const dialog = await openCommandCenter(page);
  await dialog.getByPlaceholder("Search nodes, run actions…").fill("switch 3d");
  await dialog.getByRole("option", { name: /Switch to 3D/i }).click();

  await expect(page.getByRole("dialog", { name: "Command center" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "3d", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
});
