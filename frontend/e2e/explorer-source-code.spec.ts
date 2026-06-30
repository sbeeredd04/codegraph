import { test, expect, type Page } from "@playwright/test";

// FR-70 — the real source-code surface. Selecting a node and opening "View source"
// mounts a CodeMirror 6 editor (language-aware highlighting, a line gutter, the
// node's defining line marked + scrolled to centre). It is a deliberate CM6 build,
// not Monaco: CM6 is eval-free so it boots under the strict no-eval webview CSP
// (proven separately by cm-csp-smoke). Mounted VIEW-ONLY (FR-9) — the canonical
// edit path stays "Open in editor", never a silent write — so the surface reports
// data-editable="false" and CM6's content is contenteditable="false".
//
// The default dataset (tRPC) ships no source, so we switch to the codegraph dataset
// (sourceBase = benchmark/codegraph.src) whose highest-degree node resolves to a
// real file in the sidecar, then assert the editor renders that file highlighted.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

function graphOrder(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & { __sigma?: { getGraph(): { order: number } } })
      | null;
    return el?.__sigma ? el.__sigma.getGraph().order : 0;
  });
}

async function waitForGraph(page: Page): Promise<void> {
  await expect.poll(() => graphOrder(page), { timeout: 30_000 }).toBeGreaterThan(0);
}

async function selectTopNode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: {
        getGraph(): { forEachNode(cb: (id: string) => void): void; degree(id: string): number };
        emit(ev: string, payload: { node: string }): void;
      };
    };
    const g = el.__sigma.getGraph();
    let best = "";
    let bestDeg = -1;
    g.forEachNode((id) => {
      const d = g.degree(id);
      if (d > bestDeg) {
        bestDeg = d;
        best = id;
      }
    });
    el.__sigma.emit("clickNode", { node: best });
  });
}

/** Switch to the source-bearing codegraph dataset and wait for its graph to rebuild
 * (it is materially smaller than tRPC, so the order drops once the swap lands). */
async function switchToSourcedDataset(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: "Dataset" }).selectOption("codegraph");
  await expect.poll(() => graphOrder(page), { timeout: 30_000 }).toBeLessThan(400);
}

test("FR-70: View source mounts a CodeMirror 6 surface — highlighted, def line marked, view-only", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);
  await switchToSourcedDataset(page);

  // Open the source surface for the busiest node (its file resolves in the sidecar).
  await selectTopNode(page);
  await page.getByRole("button", { name: "View source" }).click();
  const region = page.getByRole("region", { name: /Source for/ });
  await expect(region).toBeVisible();

  // The CM6 editor itself mounts (dynamic-imported off the boot path).
  const editor = region.locator(".cm-editor");
  await expect(editor).toBeVisible();
  const surface = page.getByTestId("code-surface");
  await expect(surface).toBeVisible();

  // Real source rendered, not the source-blind fallback: many lines + a gutter.
  await expect(region.getByTestId("source-unavailable")).toHaveCount(0);
  await expect(editor.locator(".cm-gutters")).toBeVisible();
  await expect.poll(async () => region.locator(".cm-line").count()).toBeGreaterThan(5);

  // Syntax highlighting is on — CM6 wraps tokens in styled spans within the lines.
  await expect.poll(async () => editor.locator(".cm-line span").count()).toBeGreaterThan(0);

  // The node's defining line is marked (the cm-defline decoration the surface adds).
  await expect(region.locator(".cm-defline")).toHaveCount(1);

  // VIEW-ONLY (FR-9): the surface advertises it, and CM6's content is not editable —
  // there is no in-webview write path; the canonical edit is "Open in editor".
  await expect(surface).toHaveAttribute("data-editable", "false");
  await expect(editor.locator(".cm-content")).toHaveAttribute("contenteditable", "false");

  await page.screenshot({ path: `${SHOT}/source-code-cm6.png` });
});
