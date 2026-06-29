import { test, expect, type Page } from "@playwright/test";

// FR-52 — universal floating panels. The dock primitive (ResizableDock) now
// exposes an optional Float control, so the knowledge drawers — which used to be
// dock-only — gain the same pop-out/drag/dock/persist behaviour the detail panel
// has. We prove it end-to-end on the diagrams drawer (a newly-migrated panel):
// float it, drag it, confirm the placement persists, dock it back, and confirm
// the float key is part of the layout that Reset clears. The drawer keeps its
// role="dialog" landmark in both docked and floating states, so the FR-28 contract
// holds. Runs on the dev server for the `__sigma` ready hook.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

const FLOATING = "floating-codegraph:dock:diagrams";

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

function readFloatPos(page: Page) {
  return page.getByTestId(FLOATING).evaluate((el) => ({
    left: parseFloat((el as HTMLElement).style.left),
    top: parseFloat((el as HTMLElement).style.top),
  }));
}

test("FR-52: the diagrams drawer floats, drags, docks back, and persists its placement", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);

  // Open the drawer docked (the default — a left dock with a dialog landmark).
  await page.getByRole("button", { name: /^Diagrams/ }).click();
  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toBeVisible();
  await expect(page.getByTestId(FLOATING)).toHaveCount(0);

  // Pop it out into a floating card via the new Float control on the handle.
  await page.getByRole("button", { name: "Float Diagrams" }).click();
  const card = page.getByTestId(FLOATING);
  await expect(card).toBeVisible();
  // It is STILL the same dialog landmark, now floating — not a downgraded panel.
  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toBeVisible();
  const start = await readFloatPos(page);

  // Drag the floating card's grab bar to a new spot (real pointer drag). Scope the
  // move handle to the card — detail can expose the same accessible name.
  const handle = card.getByRole("button", { name: "Move panel (arrow keys to nudge)" });
  const box = await handle.boundingBox();
  if (!box) throw new Error("drag handle has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 120, { steps: 8 });
  await page.mouse.up();

  const moved = await readFloatPos(page);
  expect(moved.left).toBeGreaterThan(start.left);
  expect(moved.top).toBeGreaterThan(start.top);
  await page.screenshot({ path: `${SHOT}/diagrams-floating-dragged.png` });

  // The placement persists per-browser: reload, reopen, the card returns floating
  // in the same spot — not re-docked, not at the default corner.
  await page.reload();
  await waitForGraph(page);
  await page.getByRole("button", { name: /^Diagrams/ }).click();
  await expect(card).toBeVisible();
  const after = await readFloatPos(page);
  expect(after.left).toBeCloseTo(moved.left, 0);
  expect(after.top).toBeCloseTo(moved.top, 0);

  // Dock it back from the floating grab bar — the card is gone, the docked dialog
  // is back at its edge.
  await card.getByRole("button", { name: "Dock Diagrams" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toBeVisible();
});

test("FR-52: Reset layout clears a drawer's floating placement", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  await page.getByRole("button", { name: /^Diagrams/ }).click();
  await page.getByRole("button", { name: "Float Diagrams" }).click();
  await expect(page.getByTestId(FLOATING)).toBeVisible();

  // Reset clears the float key along with every other dock/panel preference.
  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.getByTestId(FLOATING)).toHaveCount(0);

  // The reset is durable: reopen after a reload and the drawer is docked again,
  // not floating from a stale key.
  await page.reload();
  await waitForGraph(page);
  await page.getByRole("button", { name: /^Diagrams/ }).click();
  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toBeVisible();
  await expect(page.getByTestId(FLOATING)).toHaveCount(0);
});
