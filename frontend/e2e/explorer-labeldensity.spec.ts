import { test, expect, type Page } from "@playwright/test";

// FR-65 "Label density" Settings control. The 3D surface caps how many focus-set
// neighbour labels it draws (the old fixed FOCUS_LABEL_CAP=18) and de-collides the
// rest. The setting now biases that cap + the de-collision packing: "sparse" uses a
// low cap (8) so a crowded focus set suppresses its neighbour labels down to just the
// hub, while "dense" lifts the cap (48) and packs tighter so every neighbour labels.
// This drives the real flow: select a 15-node hub, switch to 3D, flip the setting in
// Settings, and assert "Dense" renders strictly MORE label DIVs than "Sparse".

const HUB = {
  version: 1,
  root: "density-demo",
  nodeCount: 15,
  edgeCount: 14,
  nodes: [
    { address: "m:src/hub.ts", kind: "module", name: "hub.ts", location: { file: "src/hub.ts", line: 0, character: 0 } },
    ...["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november"].map(
      (n, i) => ({
        address: `m:src/${n}.ts`,
        kind: "module",
        name: `${n}.ts`,
        location: { file: `src/${n}.ts`, line: i, character: 0 },
      }),
    ),
  ],
  edges: ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november"].map(
    (n) => ({ from: "m:src/hub.ts", to: `m:src/${n}.ts`, type: "depends-on" }),
  ),
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

/** Select a node through the 2D sigma surface; selection survives the surface swap. */
async function select(page: Page, address: string): Promise<void> {
  await page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: addr });
  }, address);
}

/** Pick a Label-density option in the Settings modal, then close it. */
async function setDensity(page: Page, label: "Sparse" | "Balanced" | "Dense"): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).click();
  const group = page.getByRole("group", { name: "Label density" });
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
}

/** The number of rendered 3D label divs. */
async function countLabels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-surface="3d"] [data-layer="labels"]') as HTMLElement | null;
    return layer ? layer.children.length : 0;
  });
}

/** The text of every rendered 3D label div. */
async function labelTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-surface="3d"] [data-layer="labels"]') as HTMLElement | null;
    if (!layer) return [];
    return Array.from(layer.children).map((c) => (c as HTMLElement).textContent ?? "");
  });
}

test("Label density biases how many 3D labels survive — Dense > Sparse", async ({ page }) => {
  await bootLiveSnapshot(page);

  // Select the hub on 2D (a 15-node focus set: hub + 14 neighbours), then 3D.
  await select(page, "m:src/hub.ts");
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await expect.poll(async () => countLabels(page), { timeout: 15_000 }).toBeGreaterThan(0);

  // Sparse: 15 > cap (8) → neighbour labels suppressed, only the hub centre labels.
  await setDensity(page, "Sparse");
  await expect.poll(async () => countLabels(page), { timeout: 5_000 }).toBeLessThanOrEqual(2);
  const sparse = await countLabels(page);
  // The highest-priority label (the selected hub) always survives every density.
  expect(await labelTexts(page)).toContain("hub.ts");

  // Balanced: 15 <= cap (18) → every neighbour labels, de-collided at default packing.
  await setDensity(page, "Balanced");
  await expect.poll(async () => countLabels(page), { timeout: 5_000 }).toBeGreaterThan(sparse);
  const balanced = await countLabels(page);

  // Dense: 15 <= cap (48) + tighter packing → at least as many survive as Balanced.
  await setDensity(page, "Dense");
  await expect.poll(async () => countLabels(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(balanced);
  const dense = await countLabels(page);

  expect(dense).toBeGreaterThan(sparse);
  expect(balanced).toBeGreaterThan(sparse);
  expect(dense).toBeGreaterThanOrEqual(balanced);
  expect(await labelTexts(page)).toContain("hub.ts");

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/fr65-labeldensity.png",
  });
});
