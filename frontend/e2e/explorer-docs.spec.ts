import { test, expect, type Page } from "@playwright/test";

// FR-29 — knowledge docs drawer. The codegraph self-portrait dataset carries
// agent-authored Markdown docs (seeded by scripts/seed-sample-docs.ts). Opening
// the drawer renders the selected doc as sanitized HTML; a `codegraph://node/...`
// deep-link inside the prose jumps into the graph (the FR-25 focus lens). We
// assert the Markdown renders and the in-prose deep-link selects a node.

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

test("FR-29: the docs drawer renders sanitized Markdown and deep-links into the graph", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // The default tRPC dataset carries no docs; switch to the codegraph self-portrait.
  await page.getByLabel("Dataset").selectOption("codegraph");
  await expect(page.getByRole("button", { name: /Docs\s*2/ })).toBeVisible();

  // Open the drawer — the first doc renders to sanitized HTML (marked + DOMPurify).
  await page.getByRole("button", { name: /Docs/ }).click();
  const drawer = page.getByRole("dialog", { name: "Knowledge docs" });
  await expect(drawer).toBeVisible();
  // The drawer chrome carries the authoritative title; the body is the prose.
  await expect(drawer.getByRole("heading", { name: "Architecture overview" })).toBeVisible();
  const html = drawer.locator('[data-testid="doc-html"]');
  // The Markdown rendered structured prose (a table from the GFM source).
  await expect(html.locator("table")).toBeVisible({ timeout: 15_000 });
  // T13.2: an inline ```mermaid fence in the SAME agent doc renders as a strict SVG,
  // proving sanitized prose (the GFM table) and a diagram coexist in one doc — and
  // the SVG is passive (no scripts) even though the prose allowlist forbids <svg>.
  const diagram = html.locator('[data-testid="doc-mermaid"]');
  await expect(diagram.locator("svg")).toBeVisible({ timeout: 15_000 });
  expect(await diagram.locator("script").count()).toBe(0);
  await page.screenshot({ path: `${SHOT}/docs-drawer.png` });

  // A `codegraph://node/` deep-link in the prose jumps into the graph: the drawer
  // closes and the node detail panel opens (selection + focus applied).
  const deepLink = html.locator('a[href^="codegraph://node/"]').first();
  await expect(deepLink).toBeVisible();
  await deepLink.click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "View source" })).toBeVisible();
});

test("FR-29: the docs and diagrams drawers are mutually exclusive", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  await page.getByLabel("Dataset").selectOption("codegraph");

  await page.getByRole("button", { name: /Diagrams/ }).click();
  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toBeVisible();

  // Opening Docs closes Diagrams.
  await page.getByRole("button", { name: /Docs/ }).click();
  await expect(page.getByRole("dialog", { name: "Knowledge docs" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toBeHidden();
});

test("FR-35 follow-up: the docs drawer floats as an inset panel (graph stays visible beside it)", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  await page.getByLabel("Dataset").selectOption("codegraph");
  await page.getByRole("button", { name: /Docs/ }).click();
  const drawer = page.getByRole("dialog", { name: "Knowledge docs" });
  await expect(drawer).toBeVisible();

  // Inset, not flush: the panel sits off the top-left corner (a gap from both
  // edges) so it reads as a section ON the board rather than a full-bleed page.
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThan(0);
  expect(box.y).toBeGreaterThan(0);

  // The graph canvas remains visible to the right of the floating panel.
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport) expect(box.x + box.width).toBeLessThan(viewport.width - 40);
});
