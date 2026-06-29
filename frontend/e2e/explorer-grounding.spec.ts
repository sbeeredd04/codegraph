import { test, expect, type Page } from "@playwright/test";

// FR-62 — agent grounding pipeline. The user's connected agent bulk-grounds nodes
// (the `ground_nodes` MCP tool authors a note per node); the Setup panel surfaces
// the payoff as a coverage bar — "N of M nodes grounded" — so the human sees how
// much of the graph the agent has explained, and how much is still a gap. The
// coverage is resolved by the SAME pure-core helper (groundingCoverage) the MCP
// tool reports with. Driven through the live postMessage snapshot path with a
// controlled overlay set so the count is deterministic (2 of 3 nodes grounded).

const STAMP = "2026-06-29T00:00:00.000Z";

const SNAPSHOT = {
  version: 1,
  root: "grounding-demo",
  nodeCount: 3,
  edgeCount: 2,
  nodes: [
    { address: "m:src/a.ts", kind: "module", name: "a.ts", location: { file: "src/a.ts", line: 0, character: 0 } },
    { address: "m:src/b.ts", kind: "module", name: "b.ts", location: { file: "src/b.ts", line: 0, character: 0 } },
    { address: "m:src/c.ts", kind: "module", name: "c.ts", location: { file: "src/c.ts", line: 0, character: 0 } },
  ],
  edges: [
    { from: "m:src/a.ts", to: "m:src/b.ts", type: "depends-on" },
    { from: "m:src/b.ts", to: "m:src/c.ts", type: "depends-on" },
  ],
  // Two of the three nodes carry an agent-authored grounding note (a, b); c does not.
  overlays: [
    { id: "note/a", kind: "note", anchor: { on: "node", address: "m:src/a.ts" }, body: "Entry module.", updatedAt: STAMP },
    { id: "note/b", kind: "note", anchor: { on: "node", address: "m:src/b.ts" }, body: "Mid layer.", updatedAt: STAMP },
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

test("the Setup panel shows agent grounding coverage from the snapshot's notes", async ({ page }) => {
  await bootLiveSnapshot(page);

  // The coverage lives in the Setup (onboarding) panel — open it.
  await page.getByRole("button", { name: /Setup/ }).click();
  const panel = page.getByTestId("onboarding-panel");
  await expect(panel).toBeVisible();

  // Two of the three nodes are grounded; the bar + count reflect it, and the hint
  // names the one node still awaiting grounding.
  const coverage = panel.getByTestId("grounding-coverage");
  await expect(coverage).toBeVisible();
  await expect(panel.getByTestId("grounding-count")).toHaveText("2/3");
  await expect(coverage.getByRole("progressbar", { name: "Nodes grounded by the agent" })).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await expect(coverage).toContainText("1 node still needs grounding");

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/grounding-coverage.png",
  });

  // It's dashboard chrome, not a graph lens — it survives a 2D → 3D surface swap.
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(panel.getByTestId("grounding-count")).toHaveText("2/3");
});
