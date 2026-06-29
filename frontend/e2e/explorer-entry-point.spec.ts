import { test, expect, type Page } from "@playwright/test";

// FR-56 — entry-point detection. The detail panel flags a node the pure-core
// heuristic (detectEntryPoints) identifies as a codebase entry — here a `main.ts`
// module that imports another and is imported by none — with an emerald "Entry
// point" badge and the reason. Detection is from path metadata + graph structure
// already in the snapshot (cloud-safe), so the default postMessage path suffices.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const SNAPSHOT = {
  version: 1,
  root: "entry-demo",
  nodeCount: 2,
  edgeCount: 1,
  nodes: [
    { address: "m:src/main.ts", kind: "module", name: "main.ts", location: { file: "src/main.ts", line: 0, character: 0 } },
    { address: "m:src/util.ts", kind: "module", name: "util.ts", location: { file: "src/util.ts", line: 0, character: 0 } },
  ],
  edges: [{ from: "m:src/main.ts", to: "m:src/util.ts", type: "depends-on" }],
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

async function select(page: Page, address: string): Promise<void> {
  await page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: addr });
  }, address);
}

test("FR-56: an entry-point module is flagged with a reason in the detail panel", async ({
  page,
}) => {
  await bootLiveSnapshot(page);
  await select(page, "m:src/main.ts");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  const badge = page.getByTestId("node-entry-point");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Entry point");
  await expect(badge).toContainText("main.ts");

  await page.screenshot({ path: `${SHOT}/entry-point.png` });
});

test("FR-56: an ordinary imported module shows no entry-point badge", async ({ page }) => {
  await bootLiveSnapshot(page);
  await select(page, "m:src/util.ts");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  await expect(page.getByTestId("node-entry-point")).toHaveCount(0);
});
