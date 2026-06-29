import { test, expect, type Page } from "@playwright/test";

// FR-42 — the onboarding-progress panel mirrors the agent's codegraph_onboard
// playbook for the human. The default tRPC dataset is graph-only (no agent
// diagrams/docs/overlays) so its checklist is mostly to-do; the codegraph
// self-portrait is seeded with diagrams + docs + overlays, so its checklist is
// complete. We drive the real dataset switcher and assert the panel reflects each
// fixture's actual state. Runs on the dev server for the `__sigma` ready hook.

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

async function waitForNode(page: Page, address: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((addr) => {
          const el = document.querySelector("div.absolute.inset-0") as
            | (HTMLElement & { __sigma?: { getGraph(): { hasNode(id: string): boolean } } })
            | null;
          return el?.__sigma ? el.__sigma.getGraph().hasNode(addr) : false;
        }, address),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test("FR-42: the Setup panel reflects an incomplete checklist on the graph-only dataset", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // The panel is dismissible chrome — absent until the Setup affordance is opened.
  const panel = page.getByTestId("onboarding-panel");
  await expect(panel).toHaveCount(0);

  // tRPC is indexed but carries no agent-authored knowledge → most steps to-do.
  const setup = page.getByRole("button", { name: /Setup/ });
  await expect(setup).toBeVisible();
  await setup.click();
  await expect(panel).toBeVisible();

  // Index is done (the graph exists); the knowledge-authoring steps are not.
  await expect(panel.locator('[data-step="index"]')).toHaveAttribute("data-status", "done");
  await expect(panel.locator('[data-step="architecture-diagram"]')).toHaveAttribute("data-status", "todo");
  await expect(panel.locator('[data-step="overview-doc"]')).toHaveAttribute("data-status", "todo");
  // So the checklist is incomplete (not all six done) and no hand-off yet.
  const todoCount = await panel.locator('[data-status="todo"]').count();
  expect(todoCount).toBeGreaterThan(0);
  await expect(panel.getByTestId("onboarding-handoff")).toHaveCount(0);

  // It's chrome, not a graph lens — it survives a 2D → 3D surface swap.
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(panel).toBeVisible();

  await page.screenshot({ path: `${SHOT}/onboarding-incomplete-trpc.png` });

  // Dismiss returns the canvas (the toggle reflects state via aria-pressed).
  await panel.getByRole("button", { name: "Dismiss onboarding" }).click();
  await expect(panel).toHaveCount(0);
  await expect(setup).toHaveAttribute("aria-pressed", "false");
});

test("FR-53: the onboarding panel clears the legend and is a movable card that persists its spot", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);

  await page.getByRole("button", { name: /Setup/ }).click();
  const panel = page.getByTestId("onboarding-panel");
  await expect(panel).toBeVisible();

  // The panel (default top-left) does NOT overlap the kind legend (bottom-left).
  const legend = page.getByRole("img", { name: /Legend/ });
  await expect(legend).toBeVisible();
  const pb = await panel.boundingBox();
  const lb = await legend.boundingBox();
  if (!pb || !lb) throw new Error("panel/legend missing a box");
  const disjoint =
    pb.x + pb.width <= lb.x || lb.x + lb.width <= pb.x || pb.y + pb.height <= lb.y || lb.y + lb.height <= pb.y;
  expect(disjoint).toBe(true);

  // Drag the header handle to move the card (real pointer drag) — organizable,
  // not a fixed avatar.
  const handle = panel.getByRole("button", { name: "Move panel (arrow keys to nudge)" });
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("drag handle has no bounding box");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 240, hb.y + hb.height / 2 + 170, { steps: 8 });
  await page.mouse.up();

  const movedLeft = await panel.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(movedLeft).toBeGreaterThan(pb.x + 120);

  // The placement persists per-browser: reload, reopen, the card returns to where
  // it was dragged — not the default corner.
  await page.reload();
  await waitForGraph(page);
  await page.getByRole("button", { name: /Setup/ }).click();
  await expect(panel).toBeVisible();
  const afterLeft = await panel.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(afterLeft).toBeCloseTo(movedLeft, 0);

  // Still dismissable.
  await panel.getByRole("button", { name: "Dismiss onboarding" }).click();
  await expect(panel).toHaveCount(0);
});

test("FR-42: the Setup panel shows a complete checklist on the seeded self-portrait", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Dataset").selectOption("codegraph");
  // Gate on a real codegraph node so the seeded dataset has actually swapped in.
  await waitForNode(page, "ts:src/adapters/cache/repo-cache.ts#repoCacheFile");

  await page.getByRole("button", { name: /Setup/ }).click();
  const panel = page.getByTestId("onboarding-panel");
  await expect(panel).toBeVisible();

  // The self-portrait is seeded with architecture/workflow/dataflow diagrams, an
  // onboarding doc, and hotspot marks → every authoring step reads done.
  await expect(panel.locator('[data-step="index"]')).toHaveAttribute("data-status", "done");
  await expect(panel.locator('[data-step="architecture-diagram"]')).toHaveAttribute("data-status", "done");
  await expect(panel.locator('[data-step="overview-doc"]')).toHaveAttribute("data-status", "done");
  await expect(panel.locator('[data-step="hotspots"]')).toHaveAttribute("data-status", "done");

  // No step left to do → the hand-off footer is shown.
  await expect(panel.locator('[data-status="todo"]')).toHaveCount(0);
  await expect(panel.getByTestId("onboarding-handoff")).toBeVisible();

  await page.screenshot({ path: `${SHOT}/onboarding-complete-codegraph.png` });
});
