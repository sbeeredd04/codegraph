import { test, expect, type Page } from "@playwright/test";

// FR-58 — edge call-type inspection. The detail panel classifies each neighbour
// edge by its TARGET: a `calls` edge into a class reads "constructs", into a
// function "calls", a `depends-on` into a module "imports". Incoming edges read
// from the target's side ("constructed by"). The classification is pure-core
// (describeEdgeCall) and derives from the node kinds already in the snapshot, so
// we drive it through the live-snapshot postMessage path with mixed-kind nodes.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const SNAPSHOT = {
  version: 1,
  root: "edge-demo",
  nodeCount: 4,
  edgeCount: 3,
  nodes: [
    { address: "init", kind: "function", name: "init", location: { file: "src/main.ts", line: 1, character: 0 } },
    { address: "Server", kind: "class", name: "Server", location: { file: "src/server.ts", line: 1, character: 0 } },
    { address: "helper", kind: "function", name: "helper", location: { file: "src/util.ts", line: 1, character: 0 } },
    { address: "utils", kind: "module", name: "utils", location: { file: "src/utils.ts", line: 0, character: 0 } },
  ],
  edges: [
    { from: "init", to: "Server", type: "calls" }, // → construct
    { from: "init", to: "helper", type: "calls" }, // → call
    { from: "init", to: "utils", type: "depends-on" }, // → import
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

async function select(page: Page, address: string): Promise<void> {
  await page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: addr });
  }, address);
}

test("FR-58: outgoing edges are labelled by their target — construct / call / import", async ({
  page,
}) => {
  await bootLiveSnapshot(page);
  await select(page, "init");

  const body = page.getByTestId("detail-body");
  await expect(body).toBeVisible();

  // A `calls` edge into a class reads as a construction, not a bare "calls".
  await expect(body.locator('[data-call-kind="construct"]')).toHaveText("constructs");
  // A `calls` edge into a function stays a plain call.
  await expect(body.locator('[data-call-kind="call"]')).toHaveText("calls");
  // A `depends-on` edge into a module reads as an import.
  await expect(body.locator('[data-call-kind="import"]')).toHaveText("imports");

  await page.screenshot({ path: `${SHOT}/edge-call-types.png` });
});

test("FR-58: an incoming edge reads from the target's side — 'constructed by'", async ({
  page,
}) => {
  await bootLiveSnapshot(page);
  await select(page, "Server");

  const body = page.getByTestId("detail-body");
  await expect(body).toBeVisible();
  // Server is constructed by init → the incoming row uses the inverse phrasing.
  await expect(body.locator('[data-call-kind="construct"]')).toHaveText("constructed by");
});
