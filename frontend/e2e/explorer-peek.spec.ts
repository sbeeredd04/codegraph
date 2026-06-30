import { test, expect, type Page } from "@playwright/test";

// FR-71 — bidirectional code↔graph highlight (the "connections peek").
//
// (a) graph→graph: ctrl/⌘-click a node to TRANSIENTLY spotlight it + its
//     first-degree neighbours in a distinct cyan, WITHOUT selecting it — you see
//     what a node is wired to while keeping your place (no detail panel, the
//     selected node unchanged). A plain click still selects + opens the panel,
//     and clears any peek. Re-ctrl-clicking the same node toggles the peek off.
// (b) code→graph: the source viewer's "Locate in graph" control peeks the open
//     file's node back in the graph.
//
// The peek rides the same imperative controller.highlight() path the FR-43 driver
// uses, painted topmost on both surfaces — so we assert it deterministically
// through the post-reducer display colour (2D __sigma) and the overlay resolver
// (3D __overlay3d), exactly like explorer-controller. Cyan = #22d3ee (overlay
// HIGHLIGHT_STYLE_COLOR.peek). Also captures screenshots for review.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";
const PEEK = "#22d3ee"; // overlay-style.ts HIGHLIGHT_STYLE_COLOR.peek (cyan-400)

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

/** The 2D node's post-reducer display colour (what the surface actually painted). */
async function color2d(page: Page, address: string): Promise<string | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & { __sigma?: { getNodeDisplayData(id: string): { color?: string } | undefined } })
      | null;
    const d = el?.__sigma?.getNodeDisplayData(addr);
    return d?.color ? d.color.toLowerCase() : null;
  }, address);
}

/** The 3D node's overlay-resolved draw colour, via the dev __overlay3d hook. */
async function color3d(page: Page, address: string): Promise<string | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector('[data-surface="3d"]') as
      | (HTMLElement & { __overlay3d?: (a: string) => string | null })
      | null;
    return el?.__overlay3d?.(addr)?.toLowerCase() ?? null;
  }, address);
}

/** Pick the busiest node, a neighbour, and an outsider; emit a ctrl-modified
 * clickNode on the centre (the same payload Sigma delivers on a real ⌘-click). */
async function peekTopNode(page: Page): Promise<{ center: string; neighbor: string; outsider: string }> {
  return page.evaluate(() => {
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
    const g = el.__sigma.getGraph();
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
    // Ctrl-click → peek (the handler reads event.original.ctrlKey/metaKey).
    el.__sigma.emit("clickNode", { node: center, event: { original: { ctrlKey: true } } });
    return { center, neighbor: nbrs[0], outsider };
  });
}

test("FR-71: ctrl/⌘-click peeks a node's connections without selecting it", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  await page.screenshot({ path: `${SHOT}/peek-base-2d.png` });

  const picked = await peekTopNode(page);
  expect(picked.neighbor).toBeTruthy();
  expect(picked.outsider).toBeTruthy();

  // The centre + a neighbour light cyan; the outsider does not.
  await expect.poll(() => color2d(page, picked.center), { timeout: 5_000 }).toBe(PEEK);
  expect(await color2d(page, picked.neighbor)).toBe(PEEK);
  expect(await color2d(page, picked.outsider)).not.toBe(PEEK);

  // A peek is NOT a selection: the detail panel never opens.
  await expect(page.getByTestId("detail-body")).toHaveCount(0);
  await page.screenshot({ path: `${SHOT}/peek-2d.png` });

  // Re-ctrl-clicking the same node toggles the peek off — the centre returns.
  await page.evaluate((center) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: unknown): void };
    };
    el.__sigma.emit("clickNode", { node: center, event: { original: { metaKey: true } } });
  }, picked.center);
  await expect.poll(() => color2d(page, picked.center), { timeout: 5_000 }).not.toBe(PEEK);
});

test("FR-71: a plain click clears the peek and selects (opens the detail panel)", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  const picked = await peekTopNode(page);
  await expect.poll(() => color2d(page, picked.center), { timeout: 5_000 }).toBe(PEEK);

  // A plain (unmodified) click on the same node now SELECTS it: the peek clears
  // and the detail panel opens — selection and peek are distinct interactions.
  await page.evaluate((center) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: unknown): void };
    };
    el.__sigma.emit("clickNode", { node: center, event: { original: {} } });
  }, picked.center);
  await expect(page.getByTestId("detail-body")).toBeVisible();
  await expect.poll(() => color2d(page, picked.center), { timeout: 5_000 }).not.toBe(PEEK);
});

test("FR-71: the peek paints the same cyan on the 3D surface (parity)", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // Capture a centre + neighbour before switching surfaces.
  const ids = await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: {
        getGraph(): {
          forEachNode(cb: (id: string) => void): void;
          degree(id: string): number;
          neighbors(id: string): string[];
        };
      };
    };
    const g = el.__sigma.getGraph();
    let center = "";
    let best = -1;
    g.forEachNode((id) => {
      const d = g.degree(id);
      if (d > best) {
        best = d;
        center = id;
      }
    });
    return { center, neighbor: g.neighbors(center)[0] };
  });

  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(
            (document.querySelector('[data-surface="3d"]') as (HTMLElement & { __controller?: unknown }) | null)
              ?.__controller,
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  // Drive the same peek-styled highlight the ctrl-click path emits; the 3D overlay
  // resolves it to the identical cyan as 2D (one HIGHLIGHT_STYLE_COLOR source).
  await page.evaluate(
    ({ center, neighbor }) => {
      const el = document.querySelector('[data-surface="3d"]') as HTMLElement & {
        __controller?: { highlight(a: string[], style?: string): void };
      };
      el.__controller?.highlight([center, neighbor], "peek");
    },
    ids,
  );
  await expect.poll(() => color3d(page, ids.center), { timeout: 10_000 }).toBe(PEEK);
  expect(await color3d(page, ids.neighbor)).toBe(PEEK);
  await page.screenshot({ path: `${SHOT}/peek-3d.png` });
});

test("FR-71 code→graph: the source viewer's Locate control peeks the node", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // Switch to the source-bearing dataset so "View source" mounts a real file.
  await page.getByRole("combobox", { name: "Dataset" }).selectOption("codegraph");
  await expect.poll(() => graphOrder(page), { timeout: 30_000 }).toBeLessThan(400);

  // Select the busiest node and open its source surface.
  const center = await page.evaluate(() => {
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
    return best;
  });
  await page.getByRole("button", { name: "View source" }).click();
  await expect(page.getByRole("region", { name: /Source for/ })).toBeVisible();

  // "Locate in graph" peeks the open file's node back in the graph (cyan).
  await page.getByTestId("locate-in-graph").click();
  await expect.poll(() => color2d(page, center), { timeout: 5_000 }).toBe(PEEK);
  await page.screenshot({ path: `${SHOT}/peek-locate.png` });
});
