import { test, expect, type Page } from "@playwright/test";

// FR-59 — input/output shape per node. The detail panel breaks a node's signature
// into Parameters (name + type, optional flagged) and a Returns type — all parsed
// by the pure-core `parseSignature` from structural metadata already in the
// snapshot — and renders host-local sample I/O `examples` when present. The doc's
// signature + examples ride the live local-plane message, so we drive the
// postMessage path (examples are host-local; AD-14 strips them from exports).

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const SNAPSHOT = {
  version: 1,
  root: "io-demo",
  nodeCount: 2,
  edgeCount: 0,
  nodes: [
    {
      address: "add",
      kind: "function",
      name: "add",
      location: { file: "src/math.ts", line: 1, character: 0 },
      // A wrapped callback type proves commas inside arrow params don't split.
      signature: "add(a: number, b?: string, cb: (e: Event) => void): Promise<number>",
      examples: ["add(2, 3) → 5", "add(0, 0) → 0"],
    },
    {
      address: "plain",
      kind: "module",
      name: "plain",
      location: { file: "src/x.ts", line: 0, character: 0 },
    },
  ],
  edges: [],
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

test("FR-59: the detail panel shows parsed parameters, return type, and sample I/O", async ({
  page,
}) => {
  await bootLiveSnapshot(page);
  await select(page, "add");

  await expect(page.getByTestId("detail-body")).toBeVisible();

  const params = page.getByTestId("node-params");
  await expect(params).toBeVisible();
  await expect(params).toContainText("a");
  await expect(params).toContainText("b");
  await expect(params).toContainText("cb");
  // The callback type survived intact (no comma-split inside the arrow params).
  await expect(params).toContainText("(e: Event) => void");
  // `b?` is flagged optional — exactly one of the three params here.
  await expect(params.getByText("optional")).toHaveCount(1);

  await expect(page.getByTestId("node-returns")).toContainText("Promise<number>");

  const examples = page.getByTestId("node-examples");
  await expect(examples).toContainText("add(2, 3) → 5");
  await expect(examples).toContainText("add(0, 0) → 0");

  await page.screenshot({ path: `${SHOT}/io-shape.png` });
});

test("FR-59: a node with no signature and no examples shows no I/O section", async ({ page }) => {
  await bootLiveSnapshot(page);
  await select(page, "plain");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  await expect(page.getByTestId("node-io")).toHaveCount(0);
});
