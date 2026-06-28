import { test, expect, type Page } from "@playwright/test";

// FR-28 — knowledge diagrams drawer. The codegraph self-portrait dataset carries
// agent-authored Mermaid diagrams (seeded by scripts/seed-sample-diagrams.ts).
// Opening the drawer renders the selected diagram to an SVG; a "Related nodes"
// chip jumps into the graph (the FR-25 focus lens). We assert the SVG actually
// renders (mermaid ran) and the cross-highlight selects a node.

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

test("FR-28: the diagrams drawer renders Mermaid and cross-highlights related nodes", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // The default tRPC dataset is source-blind and carries no diagrams; switch to
  // the codegraph self-portrait, which does.
  await page.getByLabel("Dataset").selectOption("codegraph");
  await expect(page.getByRole("button", { name: /Diagrams\s*4/ })).toBeVisible();

  // Open the drawer — the first diagram renders to an SVG (mermaid actually ran).
  await page.getByRole("button", { name: /Diagrams/ }).click();
  const drawer = page.getByRole("dialog", { name: "Knowledge diagrams" });
  await expect(drawer).toBeVisible();
  const svg = page.locator('[data-testid="diagram-svg"] svg');
  await expect(svg).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOT}/diagrams-drawer.png` });

  // The category index lists all four seeded diagrams across their categories.
  await expect(drawer.getByRole("button", { name: "System architecture" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Projection modes" })).toBeVisible();

  // A "Related nodes" chip jumps into the graph: the drawer closes and the node
  // detail panel opens for the chosen node (selection + focus applied).
  const chip = drawer.locator("button", { hasText: "export" }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "View source" })).toBeVisible();
});

test("FR-28: a different diagram category renders on selection", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  await page.getByLabel("Dataset").selectOption("codegraph");
  await page.getByRole("button", { name: /Diagrams/ }).click();

  const drawer = page.getByRole("dialog", { name: "Knowledge diagrams" });
  // Pick the state-diagram entry — exercises a non-flowchart mermaid grammar.
  await drawer.getByRole("button", { name: "Projection modes" }).click();
  await expect(page.locator('[data-testid="diagram-svg"] svg')).toBeVisible({ timeout: 15_000 });
});
