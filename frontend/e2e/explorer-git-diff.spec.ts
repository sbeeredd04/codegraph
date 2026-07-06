import { test, expect, type Page } from "@playwright/test";

// T14.4 — the extension's "Diff Against Git Ref" (codegraph.diffBaseline) now
// lights the unified board's Diff lens. The host builds the baseline GRAPH and
// posts it over the webview bridge as `codegraph:baseline` (source-blind —
// identities + structure only, AD-14); the client arms its diff against it.
//
// The existing explorer-diff.spec drives the lens through the dev-only `__diff`
// hook; THIS spec exercises the real PRODUCTION message path end-to-end: it fakes
// the VS Code host (so page.tsx subscribes to live snapshots), posts a live
// snapshot, then posts a baseline that differs by exactly one added + one removed
// node, and asserts the panel + on-canvas tint react. That proves the host→webview
// baseline plumbing the Dev Host uses, headlessly.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

// Must match lib/diff-palette.ts.
const ADDED = "#3fb950";

const loc = (file: string, line: number) => ({ file, line, character: 0 });

// The LIVE graph: a module containing three functions. `gamma` is the one the
// working tree added since the baseline.
const LIVE = {
  version: 1,
  root: "diff-demo",
  nodeCount: 4,
  edgeCount: 3,
  nodes: [
    { address: "mod", kind: "module", name: "app.ts", location: loc("app.ts", 0) },
    { address: "fnA", kind: "function", name: "alpha", location: loc("app.ts", 3) },
    { address: "fnB", kind: "function", name: "beta", location: loc("app.ts", 8) },
    { address: "fnNew", kind: "function", name: "gamma", location: loc("app.ts", 12) },
  ],
  edges: [
    { from: "mod", to: "fnA", type: "contains" },
    { from: "mod", to: "fnB", type: "contains" },
    { from: "mod", to: "fnNew", type: "contains" },
  ],
};

// The BASELINE graph (what the git ref looked like): no `gamma` yet, but it still
// had `deleted`, which the working tree removed.
const BASELINE = {
  version: 1,
  root: "diff-demo",
  nodeCount: 4,
  edgeCount: 3,
  nodes: [
    { address: "mod", kind: "module", name: "app.ts", location: loc("app.ts", 0) },
    { address: "fnA", kind: "function", name: "alpha", location: loc("app.ts", 3) },
    { address: "fnB", kind: "function", name: "beta", location: loc("app.ts", 8) },
    { address: "fnGhost", kind: "function", name: "deleted", location: loc("app.ts", 20) },
  ],
  edges: [
    { from: "mod", to: "fnA", type: "contains" },
    { from: "mod", to: "fnB", type: "contains" },
    { from: "mod", to: "fnGhost", type: "contains" },
  ],
};

async function bootWebview(page: Page): Promise<void> {
  // Fake the VS Code host so isWebviewHost() is true and page.tsx wires the live
  // snapshot channel (the same seam explorer-doc-fallback.spec.ts uses).
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
  }, LIVE);
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

function read2dColor(page: Page, address: string): Promise<string> {
  return page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & { __sigma?: { getNodeDisplayData(id: string): { color?: string } | undefined } })
      | null;
    return (el?.__sigma?.getNodeDisplayData(addr)?.color ?? "").toLowerCase();
  }, address);
}

test("T14.4: a host git-ref baseline posted over the bridge lights the unified board's Diff", async ({
  page,
}) => {
  await bootWebview(page);

  // The extension posts the baseline graph; the client arms the lens against it —
  // no toolbar click needed (diffMode turns on with the baseline).
  await page.evaluate((snap) => {
    window.postMessage({ type: "codegraph:baseline", snapshot: snap }, "*");
  }, BASELINE);

  // The Diff panel opens with the real delta: +1 (gamma added) / −1 (deleted removed)
  // / ~1 (app.ts changed — its member set shifted from `deleted` to `gamma`).
  await expect(page.getByTestId("diff-panel")).toBeVisible();
  await expect(page.getByTestId("diff-count")).toHaveText("3");
  await expect(page.getByTitle("1 added")).toBeVisible();
  await expect(page.getByTitle("1 removed")).toBeVisible();
  await expect(page.getByTitle("1 changed")).toBeVisible();

  // The ranked feed lists the added node, the removed ghost (panel-only, inert), and
  // the changed module — the git-ref delta rendered exactly as on the web plane.
  const addedRow = page.locator('[data-testid="diff-row"][data-change="added"]');
  await expect(addedRow).toContainText("gamma");
  const removedRow = page.locator('[data-testid="diff-row"][data-change="removed"]');
  await expect(removedRow).toContainText("deleted");

  // The added node wears the ADDED tint ON the canvas (the lens spotlights the change).
  await expect.poll(() => read2dColor(page, "fnNew")).toBe(ADDED);

  await page.screenshot({ path: `${SHOT}/git-diff-baseline.png` });
});
