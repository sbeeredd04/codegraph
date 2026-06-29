import { test, expect, type Page } from "@playwright/test";

// FR-60 — docstring fallback note. When the agent hasn't grounded a node, the
// detail panel falls back to the node's own leading doc-comment, cleaned by the
// pure-core extractor (deriveFallbackNote → extractDocSummary). The doc text is
// HOST-LOCAL (AD-14): it rides only the live local-plane message, never the
// portable snapshot — so we drive it through the same postMessage path the
// webview uses (a fake VS Code host), exactly where source is allowed.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const SNAPSHOT = {
  version: 1,
  root: "doc-demo",
  nodeCount: 2,
  edgeCount: 1,
  nodes: [
    {
      address: "doc1",
      kind: "function",
      name: "addNumbers",
      location: { file: "src/math.ts", line: 3, character: 0 },
      // A JSDoc block with a wrapped summary and trailing @tags — the extractor
      // should surface only the first paragraph, delimiters stripped.
      doc: "/**\n * Adds two numbers together and\n * returns their sum.\n * @param a the first addend\n * @returns the sum\n */",
      signature: "addNumbers(a: number, b: number): number",
    },
    {
      address: "plain",
      kind: "function",
      name: "noDoc",
      location: { file: "src/x.ts", line: 1, character: 0 },
    },
  ],
  edges: [{ from: "doc1", to: "plain", type: "calls" }],
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

test("FR-60: a node with no agent note shows its docstring as a cleaned fallback note", async ({
  page,
}) => {
  await bootLiveSnapshot(page);
  await select(page, "doc1");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  const fallback = page.getByTestId("node-doc-fallback");
  await expect(fallback).toBeVisible();
  // The first paragraph, wrapped lines joined — delimiters and @tags gone.
  await expect(fallback).toContainText("Adds two numbers together and returns their sum.");
  await expect(fallback).toContainText("From docstring");
  await expect(fallback).not.toContainText("/**");
  await expect(fallback).not.toContainText("@param");

  // It is NOT the agent's note (no violet authored-note element here).
  await expect(page.getByTestId("node-note")).toHaveCount(0);
  await page.screenshot({ path: `${SHOT}/doc-fallback-note.png` });
});

test("FR-60: a node with no docstring shows no fallback note", async ({ page }) => {
  await bootLiveSnapshot(page);
  await select(page, "plain");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  await expect(page.getByTestId("node-doc-fallback")).toHaveCount(0);
});
