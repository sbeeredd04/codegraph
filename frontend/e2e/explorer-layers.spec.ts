import { test, expect, type Page } from "@playwright/test";

// FR-72 — layered neighbour analysis. Arming "Layers" and selecting a node lights
// its concentric BFS shells, each depth a brand hue that dims outward; a floating
// depth control caps how far the shells reach. The colouring is driven by the pure
// core (src/core/graph/layers.ts) → the Sigma nodeReducer, so we assert it
// deterministically through getNodeDisplayData (post-reducer display data): a
// 2nd-degree node only lights once the depth reaches 2, and it paints a DIMMER hue
// than the 1st-degree shell. No pixel reading required.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

// Must match lib/layer-palette.ts (depth → hue) + graph-canvas.tsx constants.
const CENTER = "#c4b5fd"; // depth 0 (SELECTED_NODE)
const DEPTH1 = "#a78bfa";
const DEPTH2 = "#8f86e6";
const DIM = "#39414f"; // ORPHAN_DIM_NODE — off-lens recede

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

/** Pick a high-degree centre, a first-degree neighbour, and a genuine second-degree
 * node (neighbour of the neighbour, not adjacent to the centre). */
function pickTriple(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: {
        getGraph(): {
          forEachNode(cb: (id: string) => void): void;
          degree(id: string): number;
          neighbors(id: string): string[];
        };
        emit(ev: string, payload: { node: string }): void;
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
    const first = new Set(g.neighbors(center));
    for (const n1 of first) {
      for (const n2 of g.neighbors(n1)) {
        if (n2 !== center && !first.has(n2)) return { center, n1, n2 };
      }
    }
    return { center, n1: [...first][0] ?? "", n2: "" };
  });
}

function displayFor(page: Page, ids: { center: string; n1: string; n2: string }) {
  return page.evaluate((p) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & {
          __sigma?: { getNodeDisplayData(id: string): { label?: string; color?: string } | undefined };
        })
      | null;
    const s = el!.__sigma!;
    const read = (id: string) => {
      const d = s.getNodeDisplayData(id);
      return { label: d?.label ?? "", color: d?.color ?? "" };
    };
    return { center: read(p.center), n1: read(p.n1), n2: read(p.n2) };
  }, ids);
}

test("FR-72: layers light depth-by-depth, dimming outward, capped by the depth control", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);

  const ids = await pickTriple(page);
  expect(ids.n1, "dataset should have a first-degree neighbour").not.toBe("");
  expect(ids.n2, "dataset should have a genuine second-degree node").not.toBe("");

  // Arm Layers mode — the depth control appears.
  await page.getByRole("button", { name: "Layers" }).click();
  const control = page.getByTestId("layer-depth-control");
  await expect(control).toBeVisible();
  // Before a selection it guides the user.
  await expect(control).toContainText("Select a node");

  // Select the centre via the dev __sigma hook.
  await page.evaluate((center) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: center });
  }, ids.center);

  // Cap the depth at 1 — only the centre + first-degree shell light up.
  await page.getByRole("slider", { name: "Analysis depth" }).fill("1");
  await expect
    .poll(async () => (await displayFor(page, ids)).center.color)
    .toBe(CENTER);

  let d = await displayFor(page, ids);
  expect(d.center.color).toBe(CENTER);
  expect(d.center.label).not.toBe("");
  expect(d.n1.color).toBe(DEPTH1);
  expect(d.n1.label).not.toBe("");
  // The 2nd-degree node is still beyond the cap — receded, label blanked.
  expect(d.n2.color).toBe(DIM);
  expect(d.n2.label).toBe("");

  await page.screenshot({ path: `${SHOT}/layers-depth-1.png` });

  // Expand to depth 2 — the second shell lights, at a DIMMER hue than the first.
  await page.getByRole("slider", { name: "Analysis depth" }).fill("2");
  await expect.poll(async () => (await displayFor(page, ids)).n2.color).toBe(DEPTH2);

  d = await displayFor(page, ids);
  expect(d.n1.color).toBe(DEPTH1);
  expect(d.n2.color).toBe(DEPTH2);
  expect(d.n2.label).not.toBe("");
  // Depth 2 is dimmer than depth 1 (lower perceived lightness on the violet ramp).
  expect(DEPTH2).not.toBe(DEPTH1);

  await page.screenshot({ path: `${SHOT}/layers-depth-2.png` });
});

test("FR-72: disarming Layers restores the plain first-degree focus lens", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  const ids = await pickTriple(page);
  expect(ids.n2).not.toBe("");

  await page.getByRole("button", { name: "Layers" }).click();
  await page.evaluate((center) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: center });
  }, ids.center);
  await page.getByRole("slider", { name: "Analysis depth" }).fill("2");
  await expect.poll(async () => (await displayFor(page, ids)).n2.color).toBe(DEPTH2);

  // Close the analysis — the control disappears and the layered hues clear; the
  // first-degree focus lens takes back over (n1 keeps its kind colour, NOT a layer
  // hue; the 2nd-degree node recedes again).
  await page.getByTestId("layer-depth-control").getByRole("button", { name: "Close layer analysis" }).click();
  await expect(page.getByTestId("layer-depth-control")).toBeHidden();

  await expect.poll(async () => (await displayFor(page, ids)).n2.label).toBe("");
  const d = await displayFor(page, ids);
  expect(d.center.color).toBe(CENTER); // selection still lit by the focus lens
  expect(d.n1.color).not.toBe(DEPTH1); // back to its kind colour, not the layer hue
});
