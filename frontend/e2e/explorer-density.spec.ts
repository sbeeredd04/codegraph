import { test, expect, type Page } from "@playwright/test";

// FR-65 "Display density" Settings control. A user bias for how tightly the
// dashboard CHROME packs (toolbar, panels, docks — not the graph canvas). The
// control writes a `data-density` attribute on the explorer root <main>, and
// globals.css retunes Tailwind v4's `--spacing` token for that subtree, so every
// spacing utility rescales from one variable. This drives the real flow: open
// Settings, flip the control, and assert (1) the root attribute flips, (2) the
// computed `--spacing` token actually changes between Compact and Spacious, and
// (3) the choice persists across a reload.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const HUB = {
  version: 1,
  root: "density-demo",
  nodeCount: 3,
  edgeCount: 2,
  nodes: [
    { address: "m:src/hub.ts", kind: "module", name: "hub.ts", location: { file: "src/hub.ts", line: 0, character: 0 } },
    { address: "m:src/a.ts", kind: "module", name: "a.ts", location: { file: "src/a.ts", line: 1, character: 0 } },
    { address: "m:src/b.ts", kind: "module", name: "b.ts", location: { file: "src/b.ts", line: 2, character: 0 } },
  ],
  edges: [
    { from: "m:src/hub.ts", to: "m:src/a.ts", type: "depends-on" },
    { from: "m:src/hub.ts", to: "m:src/b.ts", type: "depends-on" },
  ],
};

async function bootLiveSnapshot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => undefined,
    });
  });
  await page.goto("/");
  await expect(page.getByText(/Loading dataset/i)).toBeVisible();
  await page.evaluate((snap) => {
    window.postMessage({ type: "codegraph:snapshot", snapshot: snap }, "*");
  }, HUB);
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

/** Pick a Display-density option in the Settings modal, then close it. */
async function setDisplayDensity(page: Page, label: "Compact" | "Comfortable" | "Spacious"): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).click();
  const group = page.getByRole("group", { name: "Display density" });
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
}

/** The explorer root that carries the density attribute + its computed --spacing. */
function root(page: Page) {
  return page.locator("main[data-density]");
}
function readSpacing(page: Page): Promise<string> {
  return root(page).evaluate((el) => getComputedStyle(el).getPropertyValue("--spacing").trim());
}

test("Display density flips the root attribute, rescales --spacing, and persists", async ({ page }) => {
  await bootLiveSnapshot(page);

  // Default is "comfortable" — the stock layout, unchanged (0.25rem).
  await expect(root(page)).toHaveAttribute("data-density", "comfortable");
  const comfy = await readSpacing(page);
  expect(parseFloat(comfy)).toBeCloseTo(0.25, 5);

  // Capture the control in situ for the UI review.
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("group", { name: "Display density" })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/fr65-display-density-settings.png` });
  await page.getByRole("button", { name: "Done" }).click();

  // Compact tightens the chrome — the attribute flips and the token shrinks.
  await setDisplayDensity(page, "Compact");
  await expect(root(page)).toHaveAttribute("data-density", "compact");
  const compact = await readSpacing(page);
  expect(parseFloat(compact)).toBeLessThan(parseFloat(comfy));

  // Spacious loosens it — the token grows past both compact and comfortable.
  await setDisplayDensity(page, "Spacious");
  await expect(root(page)).toHaveAttribute("data-density", "spacious");
  const spacious = await readSpacing(page);
  expect(parseFloat(spacious)).toBeGreaterThan(parseFloat(compact));
  expect(parseFloat(spacious)).toBeGreaterThan(parseFloat(comfy));

  await page.screenshot({ path: `${SHOT}/fr65-display-density.png` });

  // The choice survives a reload (persisted per-browser, never the snapshot).
  // bootLiveSnapshot navigates fresh, so the explorer re-seeds from localStorage.
  await bootLiveSnapshot(page);
  await expect(root(page)).toHaveAttribute("data-density", "spacious");
  expect(parseFloat(await readSpacing(page))).toBeCloseTo(parseFloat(spacious), 5);
});
