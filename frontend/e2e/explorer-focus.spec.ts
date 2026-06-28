import { test, expect, type Page } from "@playwright/test";

// FR-25 — neighbour-focus highlighting. Selecting a node lifts it + its
// first-degree neighbours out of the hairball and recedes the rest. The recede is
// driven by the pure focus lens (src/core/graph/focus.ts) fed into the Sigma
// nodeReducer, which blanks the label of every off-focus node — so we can assert
// the behaviour deterministically through getNodeDisplayData (the post-reducer
// display data), no pixel reading required. Also captures screenshots for review.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

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

type Display = { label?: string } | undefined;

function labelsFor(page: Page, ids: { center: string; neighbor: string; outsider: string }) {
  return page.evaluate((p) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & { __sigma?: { getNodeDisplayData(id: string): { label?: string } | undefined } })
      | null;
    const s = el!.__sigma!;
    const lab = (id: string): string => s.getNodeDisplayData(id)?.label ?? "";
    return { center: lab(p.center), neighbor: lab(p.neighbor), outsider: lab(p.outsider) };
  }, ids);
}

test("FR-25: selecting a node focuses its first-degree neighbourhood", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  await page.screenshot({ path: `${SHOT}/focus-base-2d.png` });

  // Pick the highest-degree node (its neighbourhood is the most telling), one of
  // its neighbours, and a node outside the neighbourhood — then select the centre.
  const picked = await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: {
        getGraph(): {
          forEachNode(cb: (id: string) => void): void;
          degree(id: string): number;
          neighbors(id: string): string[];
        };
        emit(ev: string, payload: unknown): void;
      };
    };
    const s = el.__sigma;
    const g = s.getGraph();
    let center = "";
    let best = -1;
    g.forEachNode((id) => {
      const d = g.degree(id);
      if (d > best) {
        best = d;
        center = id;
      }
    });
    const nbrs = g.neighbors(center);
    const nset = new Set(nbrs);
    let outsider = "";
    g.forEachNode((id) => {
      if (!outsider && id !== center && !nset.has(id)) outsider = id;
    });
    s.emit("clickNode", { node: center });
    return { center, neighbor: nbrs[0], outsider, degree: best };
  });

  expect(picked.degree).toBeGreaterThan(0);
  expect(picked.neighbor).toBeTruthy();
  expect(picked.outsider).toBeTruthy();

  // After selection: the centre and a neighbour keep their labels; the outsider is
  // receded — its label is blanked by the focus lens.
  await expect
    .poll(async () => (await labelsFor(page, picked)).outsider, { timeout: 5_000 })
    .toBe("");
  const focused = await labelsFor(page, picked);
  expect(focused.center).not.toBe("");
  expect(focused.neighbor).not.toBe("");
  await page.screenshot({ path: `${SHOT}/focus-2d.png` });

  // The same selection carries into the 3D surface (focus state lives in Explorer).
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/focus-3d.png` });
  await page.getByRole("button", { name: "2d", exact: true }).click();

  // Clicking empty canvas clears the lens — the outsider's label returns.
  const box = await page.locator("div.absolute.inset-0").first().boundingBox();
  await page.mouse.click(box!.x + 6, box!.y + 6);
  await expect
    .poll(async () => (await labelsFor(page, picked)).outsider, { timeout: 5_000 })
    .not.toBe("");
});
