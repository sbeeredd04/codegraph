import { test, expect, type Page } from "@playwright/test";

// FR-32 — "Open in editor" deep links. Inside the VS Code webview the host posts
// its absolute repo root alongside the live graph (transport-only, never baked
// into the portable snapshot). The source viewer then offers a `vscode://file/…`
// deep link so the user can jump from a node to the real file in their editor —
// even though the source itself stays host-local and is never shown in the page.
// We fake the webview host here; the real host wiring (explorer-panel.ts posting
// the root) is verified in the Extension Development Host. This proves the
// receiver builds the correct link.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const EDITOR_ROOT = "/Users/dev/proj";

const LIVE_SNAPSHOT = {
  version: 1,
  root: "live-repo",
  nodeCount: 3,
  edgeCount: 2,
  nodes: [
    { address: "a", kind: "module", name: "alpha.ts", location: { file: "src/alpha.ts", line: 0, character: 0 } },
    { address: "b", kind: "function", name: "beta", location: { file: "src/beta.ts", line: 1, character: 2 } },
    { address: "c", kind: "class", name: "Gamma", location: { file: "src/gamma.ts", line: 2, character: 0 } },
  ],
  edges: [
    { from: "a", to: "b", type: "depends-on" },
    { from: "b", to: "c", type: "calls" },
  ],
};

async function waitForGraph(page: Page): Promise<void> {
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

test("FR-32: the webview source viewer deep-links the file into the editor", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => undefined,
    });
  });

  await page.goto("/");
  await expect(page.getByText(/Loading dataset/i)).toBeVisible();

  // The host posts the live graph AND its absolute repo root (FR-32 transport).
  await page.evaluate(
    ({ snap, root }) => {
      window.postMessage({ type: "codegraph:snapshot", snapshot: snap, editorRoot: root }, "*");
    },
    { snap: LIVE_SNAPSHOT, root: EDITOR_ROOT },
  );

  await expect(page.getByText(/live-repo · 3 nodes/)).toBeVisible();
  await waitForGraph(page);

  // Select node "b" (src/beta.ts, line 1, char 2 — 0-based) via the dev hook.
  await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: "b" });
  });

  // Open the read-only source dock; the webview ships no source sidecar, so it
  // degrades to the "unavailable" card — which is exactly where the deep link
  // earns its keep.
  await page.getByRole("button", { name: "View source" }).click();

  // Source isn't shipped to the webview, so both affordances show: the persistent
  // header link and the prominent CTA on the "source unavailable" card.
  const open = page.getByTestId("open-in-editor");
  await expect(open).toHaveCount(2);
  const expected = `vscode://file${EDITOR_ROOT}/src/beta.ts:2:3`;
  // 0-based location (line 1, char 2) renders 1-based in the link (:2:3).
  await expect(open.first()).toHaveAttribute("href", expected);
  await expect(open.last()).toHaveAttribute("href", expected);
  await expect(open.last()).toContainText("Open in VS Code");
  await page.screenshot({ path: `${SHOT}/open-in-editor.png` });
});

test("FR-32: no deep link on the standalone web (no host root — source-blind)", async ({ page }) => {
  // No acquireVsCodeApi: the standalone web path, which has no absolute root.
  await page.goto("/");
  await waitForGraph(page);

  // Switch to the codegraph dataset (it ships source) and open a node's source.
  await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: {
        getGraph(): { forEachNode(cb: (id: string) => void): void };
        emit(ev: string, payload: { node: string }): void;
      };
    };
    let first = "";
    el.__sigma.getGraph().forEachNode((id) => {
      if (!first) first = id;
    });
    el.__sigma.emit("clickNode", { node: first });
  });
  await page.getByRole("button", { name: "View source" }).click();

  // The web plane never offers an editor deep link (AD-14: source-blind).
  await expect(page.getByTestId("open-in-editor")).toHaveCount(0);
});
