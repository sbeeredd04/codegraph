import { test, expect, type Page } from "@playwright/test";

// FR-34 — dashboard workspace usability. The node detail panel is a real dock:
// resizable (drag handle / arrow keys) and collapsible to a thin rail, with both
// preferences persisted per-browser (localStorage), never in the snapshot. We
// drive the real flow on the dev server and assert the behaviour + persistence.

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

test("FR-34: the detail dock resizes by keyboard and persists collapse across reload", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);
  await selectTopNode(page);

  const dock = page.getByRole("complementary", { name: "Details" });
  await expect(dock).toBeVisible();
  await expect(page.getByTestId("detail-body")).toBeVisible();

  // Resize via the keyboard-accessible separator: ArrowLeft widens a right dock.
  const handle = page.getByRole("separator", { name: "Resize panel" });
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const after = Number(await handle.getAttribute("aria-valuenow"));
  expect(after).toBeGreaterThan(before);
  await page.screenshot({ path: `${SHOT}/dock-expanded.png` });

  // Collapse to the rail — the body is gone, the expand affordance appears.
  await page.getByRole("button", { name: "Collapse Details" }).click();
  await expect(page.getByTestId("detail-body")).toHaveCount(0);
  const expand = page.getByRole("button", { name: "Expand Details" });
  await expect(expand).toBeVisible();
  await page.screenshot({ path: `${SHOT}/dock-collapsed.png` });

  // The collapse preference survives a reload (re-selecting a node re-mounts the
  // dock, which reads the persisted state).
  await page.reload();
  await waitForGraph(page);
  await selectTopNode(page);
  await expect(page.getByRole("button", { name: "Expand Details" })).toBeVisible();
  await expect(page.getByTestId("detail-body")).toHaveCount(0);

  // Expanding restores the content.
  await page.getByRole("button", { name: "Expand Details" }).click();
  await expect(page.getByTestId("detail-body")).toBeVisible();
});

test("FR-34: the source viewer resizes by keyboard and persists width across reload", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);
  await selectTopNode(page);

  // Open the read-only code dock from the detail panel.
  await page.getByRole("button", { name: "View source" }).click();
  const viewer = page.getByRole("region", { name: /Source for/ });
  await expect(viewer).toBeVisible();

  // Resize via its own keyboard-accessible separator (scoped to the viewer, since
  // both docks expose a "Resize panel" handle — though never simultaneously).
  const handle = viewer.getByRole("separator", { name: "Resize panel" });
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  const widened = Number(await handle.getAttribute("aria-valuenow"));
  expect(widened).toBeGreaterThan(before);
  await page.screenshot({ path: `${SHOT}/source-dock-resized.png` });

  // The width survives a reload — re-selecting the node and re-opening the dock
  // re-mounts the viewer, which reads the persisted width.
  await page.reload();
  await waitForGraph(page);
  await selectTopNode(page);
  await page.getByRole("button", { name: "View source" }).click();
  const restored = Number(
    await page
      .getByRole("region", { name: /Source for/ })
      .getByRole("separator", { name: "Resize panel" })
      .getAttribute("aria-valuenow"),
  );
  expect(restored).toBe(widened);
});

test("FR-34: a resized width persists across reload", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);
  await selectTopNode(page);

  const handle = page.getByRole("separator", { name: "Resize panel" });
  await handle.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
  const widened = Number(await handle.getAttribute("aria-valuenow"));

  await page.reload();
  await waitForGraph(page);
  await selectTopNode(page);
  const restored = Number(
    await page.getByRole("separator", { name: "Resize panel" }).getAttribute("aria-valuenow"),
  );
  expect(restored).toBe(widened);
});

// The left knowledge drawers (diagrams/docs) are the same dock primitive on the
// other edge: a left dock widens on ArrowRight, collapses to a rail, and persists
// both. They keep their role="dialog" landmark (the source/detail docks don't),
// so the FR-28/29 contracts hold — verified by scoping queries to the dialog.

test("FR-34: the diagrams drawer resizes by keyboard and persists width across reload", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);

  await page.getByRole("button", { name: /^Diagrams/ }).click();
  const drawer = page.getByRole("dialog", { name: "Knowledge diagrams" });
  await expect(drawer).toBeVisible();

  // A left dock widens on ArrowRight (mirror of the right docks).
  const handle = drawer.getByRole("separator", { name: "Resize panel" });
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  const widened = Number(await handle.getAttribute("aria-valuenow"));
  expect(widened).toBeGreaterThan(before);
  await page.screenshot({ path: `${SHOT}/diagrams-dock-resized.png` });

  await page.reload();
  await waitForGraph(page);
  await page.getByRole("button", { name: /^Diagrams/ }).click();
  const restored = Number(
    await page
      .getByRole("dialog", { name: "Knowledge diagrams" })
      .getByRole("separator", { name: "Resize panel" })
      .getAttribute("aria-valuenow"),
  );
  expect(restored).toBe(widened);
});

test("FR-34: the diagrams drawer collapses to a rail and the collapse persists", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);

  // The default tRPC dataset carries no diagrams — the onboarding body is the
  // proxy for "the drawer content is showing".
  await page.getByRole("button", { name: /^Diagrams/ }).click();
  await expect(page.getByText("No diagrams yet")).toBeVisible();

  // Collapse to the rail: the body is gone, the expand affordance appears.
  await page.getByRole("button", { name: "Collapse Diagrams" }).click();
  await expect(page.getByText("No diagrams yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand Diagrams" })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/diagrams-dock-collapsed.png` });

  // The collapse is part of the persisted layout: reload + reopen mounts the rail.
  await page.reload();
  await waitForGraph(page);
  await page.getByRole("button", { name: /^Diagrams/ }).click();
  await expect(page.getByRole("button", { name: "Expand Diagrams" })).toBeVisible();
  await expect(page.getByText("No diagrams yet")).toHaveCount(0);

  // Expanding restores the body.
  await page.getByRole("button", { name: "Expand Diagrams" }).click();
  await expect(page.getByText("No diagrams yet")).toBeVisible();
});

test("FR-34: the docs drawer resizes and persists width (distinct from diagrams)", async ({
  page,
}) => {
  await page.goto("/");
  await waitForGraph(page);

  await page.getByRole("button", { name: /^Docs/ }).click();
  const drawer = page.getByRole("dialog", { name: "Knowledge docs" });
  await expect(drawer).toBeVisible();

  const handle = drawer.getByRole("separator", { name: "Resize panel" });
  await handle.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  const widened = Number(await handle.getAttribute("aria-valuenow"));

  await page.reload();
  await waitForGraph(page);
  await page.getByRole("button", { name: /^Docs/ }).click();
  const restored = Number(
    await page
      .getByRole("dialog", { name: "Knowledge docs" })
      .getByRole("separator", { name: "Resize panel" })
      .getAttribute("aria-valuenow"),
  );
  expect(restored).toBe(widened);
});
