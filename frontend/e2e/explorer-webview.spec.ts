import { test, expect } from "@playwright/test";

// Epic 7.4 — the frontend half of the panel cutover: inside the VS Code webview
// the app must render the LIVE graph the host posts, not the bundled sample. We
// fake `acquireVsCodeApi` (VS Code's webview-detection global) before load so the
// page takes the webview branch, then post a snapshot and assert it renders. The
// real host wiring (panel.ts posting this message) is verified in the Extension
// Development Host; this proves the receiver.

// A tiny, unmistakable graph — 3 nodes, so it can't be confused with the
// 590-node tRPC sample the standalone web would otherwise fetch.
const LIVE_SNAPSHOT = {
  version: 1,
  root: "live-repo",
  nodeCount: 3,
  edgeCount: 2,
  nodes: [
    { address: "a", kind: "module", name: "alpha.ts", location: { file: "src/alpha.ts", line: 0, character: 0 } },
    { address: "b", kind: "function", name: "beta", location: { file: "src/beta.ts", line: 1, character: 0 } },
    { address: "c", kind: "class", name: "Gamma", location: { file: "src/gamma.ts", line: 2, character: 0 } },
  ],
  edges: [
    { from: "a", to: "b", type: "depends-on" },
    { from: "b", to: "c", type: "calls" },
  ],
};

test("inside the webview, the app renders the host-posted graph (not the sample)", async ({ page }) => {
  // Make the page believe it is hosted in a VS Code webview.
  await page.addInitScript(() => {
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => undefined,
    });
  });

  await page.goto("/");

  // Webview mode does NOT fetch the bundled sample — it waits for the host.
  await expect(page.getByText(/Loading dataset/i)).toBeVisible();

  // The host posts the live graph.
  await page.evaluate((snap) => {
    window.postMessage({ type: "codegraph:snapshot", snapshot: snap }, "*");
  }, LIVE_SNAPSHOT);

  // The posted 3-node graph renders; the 590-node sample never appears.
  await expect(page.getByText(/live-repo · 3 nodes/)).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByText(/590 nodes/)).toHaveCount(0);

  // No sample dataset switcher in the webview.
  await expect(page.getByLabel("Dataset")).toHaveCount(0);
});
