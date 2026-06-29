import { test, expect, type Page } from "@playwright/test";

// FR-66 — cross-surface navigation between the explorer board and the FR-35
// landing page (`/welcome`). The landing page already links INTO the board; this
// proves the reverse: a "Home" link in the toolbar takes you to the landing page
// on the web/cloud plane, the landing page's "Explorer" link brings you back, and
// the Home link is WITHHELD inside the VS Code webview (where the embedded board
// has no marketing page to return to — AD-14).

// The 2D Sigma surface exposes its graph on the container's __sigma hook once
// booted; waiting on it proves the Explorer toolbar (and the Home link) is mounted.
async function waitForBoot(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
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

test("the board's Home link reaches the landing page, and it links back (FR-66)", async ({ page }) => {
  await page.goto("/");
  await waitForBoot(page);

  // The toolbar carries a Home link pointing at the landing route.
  const home = page.getByRole("link", { name: "Home" });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("href", "/welcome");

  await page.locator("header").first().screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/fr66-toolbar-home.png",
  });

  // Clicking it lands on the FR-35 marketing page (its hero is unmistakable).
  await home.click();
  await expect(page.getByRole("heading", { name: /living map/i })).toBeVisible();

  // And the landing page links back into the board — the round trip closes.
  await page.getByRole("link", { name: "Explorer", exact: true }).click();
  await waitForBoot(page);
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
});

test("inside the VS Code webview the Home link is withheld (FR-66 / AD-14)", async ({ page }) => {
  // Make the page believe it is hosted in a VS Code webview, then feed it a live
  // host graph (no bundled sample, no marketing page to return to).
  await page.addInitScript(() => {
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => undefined,
    });
  });
  await page.goto("/");
  await expect(page.getByText(/Loading dataset/i)).toBeVisible();
  await page.evaluate(() => {
    window.postMessage(
      {
        type: "codegraph:snapshot",
        snapshot: {
          version: 1,
          root: "live-repo",
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { address: "a", kind: "module", name: "a.ts", location: { file: "src/a.ts", line: 0, character: 0 } },
            { address: "b", kind: "module", name: "b.ts", location: { file: "src/b.ts", line: 0, character: 0 } },
          ],
          edges: [{ from: "a", to: "b", type: "depends-on" }],
        },
      },
      "*",
    );
  });

  // The live host graph renders (proves we took the webview branch)...
  await expect(page.getByText(/live-repo · 2 nodes/)).toBeVisible();
  // ...and the Home link is absent — the Guide link (always available) stays.
  await expect(page.getByRole("link", { name: "Home" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Guide" })).toBeVisible();
});
