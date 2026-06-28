import { test, expect, type Page } from "@playwright/test";

// End-to-end coverage of the explorer's core flow, codifying the manual
// verification done while building Stories 8.1/FR-15 and 8.4. Runs against the
// dev server (see playwright.config.ts) so the dev-only `__sigma` hook is present.

/** Wait until the Sigma renderer is mounted with a laid-out graph, then return its order. */
async function waitForGraph(page: Page): Promise<number> {
  return await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector("div.absolute.inset-0") as (HTMLElement & { __sigma?: unknown }) | null;
          const sigma = el?.__sigma as { getGraph(): { order: number } } | undefined;
          return sigma ? sigma.getGraph().order : 0;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
    .then(() =>
      page.evaluate(() => {
        const el = document.querySelector("div.absolute.inset-0") as (HTMLElement & { __sigma?: { getGraph(): { order: number } } }) | null;
        return el!.__sigma!.getGraph().order;
      }),
    );
}

/** Select a node by firing the real Sigma clickNode; returns the picked node's facts. */
async function selectSourceBearingNode(page: Page): Promise<{ id: string; file: string; line: number }> {
  return await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as (HTMLElement & { __sigma?: { getGraph(): { forEachNode(cb: (id: string, a: Record<string, unknown>) => void): void }; emit(ev: string, p: unknown): void } }) | null;
    const sigma = el!.__sigma!;
    const g = sigma.getGraph();
    let pick: { id: string; file: string; line: number } | null = null;
    g.forEachNode((id, a) => {
      if (pick) return;
      const kind = a.kind as string;
      const file = a.file as string;
      const line = a.line as number;
      if ((kind === "function" || kind === "method") && /\.ts$/.test(file ?? "") && line > 0) {
        pick = { id, file, line };
      }
    });
    if (!pick) throw new Error("no source-bearing node found");
    sigma.emit("clickNode", { node: pick.id });
    return pick;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Switch to the first-party sample that ships source (FR-15 needs real bytes).
  await page.getByLabel("Dataset").selectOption("codegraph");
  await waitForGraph(page);
});

test("FR-15: selecting a node opens a read-only, def-anchored source viewer", async ({ page }) => {
  const node = await selectSourceBearingNode(page);

  // Detail panel appears for the selected node and offers "View source".
  const viewSource = page.getByRole("button", { name: "View source" });
  await expect(viewSource).toBeVisible();
  await viewSource.click();

  const viewer = page.getByRole("region", { name: /Source for/ });
  await expect(viewer).toBeVisible();

  // Header path shows file:1-based-line.
  await expect(viewer.getByText(`${node.file}:${node.line + 1}`)).toBeVisible();

  // Read-only badge present; the def line is rendered and highlighted.
  await expect(viewer.getByText("Read-only")).toBeVisible();

  const facts = await viewer.evaluate((root) => {
    const lines = root.querySelectorAll("pre code > div");
    const anchor = root.querySelector("div.bg-violet-500\\/10");
    const editable = root.querySelectorAll('textarea, [contenteditable="true"], input');
    return { lineCount: lines.length, hasAnchor: !!anchor, editableCount: editable.length };
  });
  expect(facts.lineCount).toBeGreaterThan(0);
  expect(facts.hasAnchor).toBe(true);
  expect(facts.editableCount).toBe(0); // FR-9: strictly passive, no edit affordance

  // Esc returns to the detail panel.
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});

test("Story 8.4: ⌘K palette searches, navigates by keyboard, and selects a node", async ({ page }) => {
  await page.getByRole("button", { name: "Search nodes" }).click();

  const dialog = page.getByRole("dialog", { name: "Search nodes" });
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("graph");

  const options = dialog.getByRole("option");
  await expect.poll(async () => options.count()).toBeGreaterThan(0);

  // aria-activedescendant tracks the active row; ArrowDown advances it.
  const before = await input.getAttribute("aria-activedescendant");
  expect(before).toBeTruthy();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => input.getAttribute("aria-activedescendant")).not.toBe(before);

  // Enter selects: the palette closes and the detail panel is shown.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "View source" })).toBeVisible();
});

test("⌘K keyboard shortcut opens and Escape closes the palette", async ({ page }) => {
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Search nodes" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
