import { test, expect, type Page } from "@playwright/test";

// FR-56 (3D parity) — the pure-core entry-point heuristic (detectEntryPoints) flags
// the node where execution likely begins; the detail panel already badges it
// emerald. This proves the 3D surface gives the matching cue: an emerald ring on
// the entry node, exposed for assertion via the dev __entry3d hook. Driven through
// the live postMessage snapshot path so the graph is deterministic — main.ts is a
// dependency root (no inbound imports, pulls in three helpers) → a strong entry.

const SNAPSHOT = {
  version: 1,
  root: "entry-demo",
  nodeCount: 4,
  edgeCount: 3,
  nodes: [
    { address: "m:src/main.ts", kind: "module", name: "main.ts", location: { file: "src/main.ts", line: 0, character: 0 } },
    { address: "m:src/a.ts", kind: "module", name: "a.ts", location: { file: "src/a.ts", line: 0, character: 0 } },
    { address: "m:src/b.ts", kind: "module", name: "b.ts", location: { file: "src/b.ts", line: 0, character: 0 } },
    { address: "m:src/c.ts", kind: "module", name: "c.ts", location: { file: "src/c.ts", line: 0, character: 0 } },
  ],
  edges: [
    { from: "m:src/main.ts", to: "m:src/a.ts", type: "depends-on" },
    { from: "m:src/main.ts", to: "m:src/b.ts", type: "depends-on" },
    { from: "m:src/main.ts", to: "m:src/c.ts", type: "depends-on" },
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
  }, SNAPSHOT);
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

/** Whether the 3D surface painted an entry-point ring on an address, via __entry3d. */
async function entry3d(page: Page, address: string): Promise<boolean | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector('[data-surface="3d"]') as
      | (HTMLElement & { __entry3d?: (a: string) => boolean })
      | null;
    return el?.__entry3d ? el.__entry3d(addr) : null;
  }, address);
}

test("the 3D surface rings the detected entry point and nothing else", async ({ page }) => {
  await bootLiveSnapshot(page);

  // Switch to 3D — the surface builds the entry markers from the same pure-core
  // detection the detail panel uses.
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();

  // main.ts (a dependency root) carries the emerald entry ring; the helpers do not.
  await expect.poll(() => entry3d(page, "m:src/main.ts"), { timeout: 15_000 }).toBe(true);
  expect(await entry3d(page, "m:src/a.ts")).toBe(false);
  expect(await entry3d(page, "m:src/b.ts")).toBe(false);

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/fr56-entry-3d.png",
  });
});
