import { test, expect, type Page } from "@playwright/test";

// FR-65 (3D label collision-avoidance). renderLabels() used to drop an HTML overlay
// at every to-label node's projected position with no overlap handling, so a crowded
// focus set stacked labels illegibly. The screen-space de-collision pass (lib/
// label-layout-3d) now keeps the high-priority labels and drops/nudges the ones that
// would overlap. This drives the real surface: select a hub (7-node focus set),
// switch to 3D, and assert the rendered label boxes never overlap — even zoomed far
// out, where every neighbour collapses onto the same screen point.

const HUB = {
  version: 1,
  root: "hub-demo",
  nodeCount: 7,
  edgeCount: 6,
  nodes: [
    { address: "m:src/hub.ts", kind: "module", name: "hub.ts", location: { file: "src/hub.ts", line: 0, character: 0 } },
    { address: "m:src/a.ts", kind: "module", name: "alpha.ts", location: { file: "src/a.ts", line: 0, character: 0 } },
    { address: "m:src/b.ts", kind: "module", name: "bravo.ts", location: { file: "src/b.ts", line: 0, character: 0 } },
    { address: "m:src/c.ts", kind: "module", name: "charlie.ts", location: { file: "src/c.ts", line: 0, character: 0 } },
    { address: "m:src/d.ts", kind: "module", name: "delta.ts", location: { file: "src/d.ts", line: 0, character: 0 } },
    { address: "m:src/e.ts", kind: "module", name: "echo.ts", location: { file: "src/e.ts", line: 0, character: 0 } },
    { address: "m:src/f.ts", kind: "module", name: "foxtrot.ts", location: { file: "src/f.ts", line: 0, character: 0 } },
  ],
  edges: [
    { from: "m:src/hub.ts", to: "m:src/a.ts", type: "depends-on" },
    { from: "m:src/hub.ts", to: "m:src/b.ts", type: "depends-on" },
    { from: "m:src/hub.ts", to: "m:src/c.ts", type: "depends-on" },
    { from: "m:src/hub.ts", to: "m:src/d.ts", type: "depends-on" },
    { from: "m:src/hub.ts", to: "m:src/e.ts", type: "depends-on" },
    { from: "m:src/hub.ts", to: "m:src/f.ts", type: "depends-on" },
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
  }, HUB);
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

/** Select a node through the 2D sigma surface; selection survives the surface swap. */
async function select(page: Page, address: string): Promise<void> {
  await page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: addr });
  }, address);
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

/** The bounding rects + text of every rendered 3D label div. */
async function labelRects(page: Page): Promise<LabelBox[]> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-surface="3d"] [data-layer="labels"]') as HTMLElement | null;
    if (!layer) return [];
    return Array.from(layer.children).map((c) => {
      const r = (c as HTMLElement).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: (c as HTMLElement).textContent ?? "" };
    });
  });
}

function overlapPx(a: LabelBox, b: LabelBox): { ox: number; oy: number } {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { ox, oy };
}

test("3D labels never overlap, even when a focus cluster collapses on screen", async ({ page }) => {
  await bootLiveSnapshot(page);

  // Select the hub on 2D, then switch to 3D — the focus lens labels the hub + its
  // six neighbours (a 7-node set, under the focus label cap).
  await select(page, "m:src/hub.ts");
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();

  await expect.poll(async () => (await labelRects(page)).length, { timeout: 15_000 }).toBeGreaterThan(1);

  // At the default framing the labels already de-collide. Assert no two boxes overlap
  // by more than a 1px rounding slack on both axes.
  const assertNoOverlap = async (): Promise<void> => {
    const rects = await labelRects(page);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const { ox, oy } = overlapPx(rects[i], rects[j]);
        expect(ox > 1 && oy > 1, `labels ${i} and ${j} overlap (${ox}x${oy}px)`).toBe(false);
      }
    }
  };
  await assertNoOverlap();

  // Zoom hard out so the seven nodes crowd toward the screen centre — heavy
  // collision pressure. The pass must keep boxes apart (nudge or drop), never stack.
  const box = await page.locator('[data-surface="3d"] canvas').boundingBox();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(cx, cy);
  for (let k = 0; k < 4; k++) await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);

  // The survivors still never overlap…
  await assertNoOverlap();
  // …and the highest-priority label (the selected hub, priority 0) always survives.
  const crowded = await labelRects(page);
  expect(crowded.some((l) => l.text === "hub.ts")).toBe(true);

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/fr65-labels3d.png",
  });
});
