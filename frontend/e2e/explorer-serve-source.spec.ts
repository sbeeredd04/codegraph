import { test, expect, type Page } from "@playwright/test";

// T14.3 — `codegraph serve` runs on the user's machine where the source lives
// (AD-16), so it exposes a host-local source channel and tells the board its
// `sourceBase` alongside the live snapshot. The board then fetches a node's file
// and renders it inline, instead of the source-blind card — fixing the "View
// source doesn't work" gap on a locally-served repo.
//
// This drives the PRODUCTION path headlessly: it fakes the VS Code host (so the
// board takes the live-snapshot channel), route-mocks the `/__cgsrc/` source
// endpoint the serve server would answer, posts a snapshot carrying `sourceBase`,
// then opens View source and asserts the CodeMirror surface renders the file.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const SOURCE = "def login(user, token):\n    # authenticate the caller\n    return verify(user, token)\n";

const SNAPSHOT = {
  version: 1,
  root: "serve-demo",
  nodeCount: 2,
  edgeCount: 1,
  nodes: [
    { address: "mod", kind: "module", name: "auth.py", location: { file: "src/auth.py", line: 0, character: 0 } },
    { address: "fn", kind: "function", name: "login", location: { file: "src/auth.py", line: 0, character: 0 } },
  ],
  edges: [{ from: "mod", to: "fn", type: "contains" }],
};

async function bootServe(page: Page): Promise<void> {
  // The serve server answers the source channel; here we mock it so the fetch the
  // board makes (`__cgsrc/src/auth.py`) returns the file, exactly as serve would.
  await page.route("**/__cgsrc/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: SOURCE }),
  );
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
    // The envelope `codegraph serve` injects: the snapshot plus a sibling sourceBase
    // (transport-only) pointing at the host-local source endpoint.
    window.postMessage({ type: "codegraph:snapshot", snapshot: snap, sourceBase: "__cgsrc" }, "*");
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

test("T14.3: a served repo renders node source inline from the host-local source channel", async ({
  page,
}) => {
  await bootServe(page);

  // Select the function node and open its source.
  await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: "fn" });
  });
  await page.getByRole("button", { name: "View source" }).click();

  const region = page.getByRole("region", { name: /Source for/ });
  await expect(region).toBeVisible();

  // The real source rendered inline — NOT the source-blind card.
  await expect(region.getByTestId("source-unavailable")).toHaveCount(0);
  const surface = page.getByTestId("code-surface");
  await expect(surface).toBeVisible();
  await expect(region.locator(".cm-editor")).toBeVisible();
  await expect(region.getByText("def login")).toBeVisible();

  await page.screenshot({ path: `${SHOT}/serve-source-inline.png` });
});
