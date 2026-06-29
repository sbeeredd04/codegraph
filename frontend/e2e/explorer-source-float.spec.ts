import { test, expect, type Page } from "@playwright/test";

// FR-52 — the read-only source viewer joins the floating-panel system. It opens
// docked (resizable right dock, the default) but can pop OUT into a draggable card
// the user places anywhere, with the placement persisted per-browser (localStorage,
// never the snapshot). Through it all it stays a role="region"/"Source for…"
// landmark (FR-15) and keeps Close + the editor deep-link — only its frame changes.

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

async function openSource(page: Page): Promise<void> {
  await selectTopNode(page);
  await page.getByRole("button", { name: "View source" }).click();
  await expect(page.getByRole("region", { name: /Source for/ })).toBeVisible();
}

function readFloatPos(page: Page) {
  return page.getByTestId("source-floating").evaluate((el) => ({
    left: parseFloat((el as HTMLElement).style.left),
    top: parseFloat((el as HTMLElement).style.top),
  }));
}

test("FR-52: the source viewer floats, drags, persists its spot, and docks back", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);
  await openSource(page);

  // Docked is the default — it is the FR-15 region landmark and shows its identity.
  const region = page.getByRole("region", { name: /Source for/ });
  await expect(region.getByText("Read-only")).toBeVisible();

  // Pop it out into a floating card. Still the same region landmark, just framed
  // as a draggable card (FR-15 contract preserved across the mode change).
  await page.getByRole("button", { name: "Float source viewer" }).click();
  const floating = page.getByTestId("source-floating");
  await expect(floating).toBeVisible();
  await expect(floating).toHaveAttribute("role", "region");
  await expect(floating.getByText("Read-only")).toBeVisible();
  const start = await readFloatPos(page);

  // Drag the header grip to a new position (real pointer drag), scoped to this card
  // so it never resolves the detail panel's identically-labelled grip.
  const grip = floating.getByRole("button", { name: "Move panel (arrow keys to nudge)" });
  const box = await grip.boundingBox();
  if (!box) throw new Error("source drag grip has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 130, box.y + box.height / 2 + 80, { steps: 8 });
  await page.mouse.up();

  const moved = await readFloatPos(page);
  expect(moved.left).toBeGreaterThan(start.left);
  expect(moved.top).toBeGreaterThan(start.top);
  await page.screenshot({ path: `${SHOT}/source-floating-dragged.png` });

  // The placement survives a reload — re-selecting + re-opening re-mounts the
  // viewer, which reads the persisted offset and returns floating in the same spot.
  await page.reload();
  await waitForGraph(page);
  await openSource(page);
  await expect(page.getByTestId("source-floating")).toBeVisible();
  const after = await readFloatPos(page);
  expect(after.left).toBeCloseTo(moved.left, 0);
  expect(after.top).toBeCloseTo(moved.top, 0);

  // Docking it back returns to the full-height resizable dock (its own separator).
  await page.getByRole("button", { name: "Dock source viewer" }).click();
  await expect(page.getByTestId("source-floating")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /Source for/ }).getByRole("separator", { name: "Resize panel" }),
  ).toBeVisible();
});

test("FR-52: Reset layout re-docks a floated source viewer", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  await openSource(page);

  await page.getByRole("button", { name: "Float source viewer" }).click();
  await expect(page.getByTestId("source-floating")).toBeVisible();

  // One control clears every layout preference (FR-9 layout-only, no source change).
  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.getByTestId("source-floating")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /Source for/ }).getByRole("separator", { name: "Resize panel" }),
  ).toBeVisible();

  // Durable: the reset cleared the key, so a reload + re-open comes back docked.
  await page.reload();
  await waitForGraph(page);
  await openSource(page);
  await expect(page.getByTestId("source-floating")).toHaveCount(0);
});
