import { test, expect, type Page } from "@playwright/test";

// FR-85 — decorators/routes in the detail panel. A decorated Python declaration
// (a FastAPI route, @property, @dataclass) carries a structural, cloud-safe
// `decorators` field; the panel surfaces it as chips so routes/handlers are
// legible. The field rides the portable snapshot (unlike host-local doc), so a
// plain snapshot (not the live webview path) is enough to exercise it.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const SNAPSHOT = {
  version: 1,
  root: "api-demo",
  nodeCount: 2,
  edgeCount: 1,
  nodes: [
    {
      address: "route",
      kind: "function",
      name: "list_users",
      location: { file: "api.py", line: 2, character: 0 },
      signature: "list_users(limit: int = 10) -> list",
      decorators: ["app.get('/users')"],
    },
    {
      address: "plain",
      kind: "function",
      name: "helper",
      location: { file: "api.py", line: 9, character: 0 },
    },
  ],
  edges: [{ from: "route", to: "plain", type: "calls" }],
};

async function bootSnapshot(page: Page): Promise<void> {
  // The board consumes an injected `codegraph:snapshot` only in webview mode, so
  // stub the VS Code API before load (decorators ride the portable snapshot, so no
  // host-local channel is needed — this is just to open the injection path).
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

test("FR-85: a decorated node shows its decorator as a chip in the detail panel", async ({ page }) => {
  await bootSnapshot(page);
  await select(page, "route");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  const decorators = page.getByTestId("node-decorators");
  await expect(decorators).toBeVisible();
  await expect(decorators).toContainText("@app.get('/users')");
  await page.screenshot({ path: `${SHOT}/fr85-decorators.png` });
});

test("FR-85: an undecorated node shows no decorator chips", async ({ page }) => {
  await bootSnapshot(page);
  await select(page, "plain");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  await expect(page.getByTestId("node-decorators")).toHaveCount(0);
});
