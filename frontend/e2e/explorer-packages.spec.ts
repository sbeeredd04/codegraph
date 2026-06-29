import { test, expect, type Page } from "@playwright/test";

// FR-57 — monorepo / package partition. The pure-core `partitionByPackage`
// derives packages from the nodes' `location.file` (structural, cloud-safe). The
// toolbar surfaces a "Package" filter for a genuinely multi-package repo, and the
// detail panel tags each node with its package. Single-package graphs show no
// filter. Driven through the default postMessage path (detection is structural).

const SNAPSHOT = {
  version: 1,
  root: "monorepo-demo",
  nodeCount: 3,
  edgeCount: 2,
  nodes: [
    { address: "m:packages/web/src/app.ts", kind: "module", name: "app.ts", location: { file: "packages/web/src/app.ts", line: 0, character: 0 } },
    { address: "m:packages/web/src/util.ts", kind: "module", name: "util.ts", location: { file: "packages/web/src/util.ts", line: 0, character: 0 } },
    { address: "m:packages/server/src/index.ts", kind: "module", name: "index.ts", location: { file: "packages/server/src/index.ts", line: 0, character: 0 } },
  ],
  edges: [
    { from: "m:packages/web/src/app.ts", to: "m:packages/web/src/util.ts", type: "depends-on" },
    { from: "m:packages/web/src/app.ts", to: "m:packages/server/src/index.ts", type: "depends-on" },
  ],
};

const SINGLE_PACKAGE = {
  version: 1,
  root: "flat-demo",
  nodeCount: 2,
  edgeCount: 1,
  nodes: [
    { address: "m:src/a.ts", kind: "module", name: "a.ts", location: { file: "src/a.ts", line: 0, character: 0 } },
    { address: "m:src/b.ts", kind: "module", name: "b.ts", location: { file: "src/b.ts", line: 0, character: 0 } },
  ],
  edges: [{ from: "m:src/a.ts", to: "m:src/b.ts", type: "depends-on" }],
};

async function bootLiveSnapshot(page: Page, snapshot: unknown): Promise<void> {
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
  }, snapshot);
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

async function select(page: Page, address: string): Promise<void> {
  await page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: addr });
  }, address);
}

/** The 3D draw colour for an address (package tint when colour-by-package is on). */
async function overlay3d(page: Page, address: string): Promise<string | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector('[data-surface="3d"]') as
      | (HTMLElement & { __overlay3d?: (a: string) => string | null })
      | null;
    return el?.__overlay3d ? el.__overlay3d(addr) : null;
  }, address);
}

// Persistent per-package tints (FR-57). Palette is keyed by the partition's order
// (most-populated first): web → [0], server → [1]. Kept in sync with
// lib/package-palette.ts (PACKAGE_PALETTE).
const WEB_TINT = "#8b9bff";
const SERVER_TINT = "#e7a6c4";

test("FR-57: a multi-package repo gets a package filter listing each package by count", async ({
  page,
}) => {
  await bootLiveSnapshot(page, SNAPSHOT);
  const pkg = page.getByRole("combobox", { name: "Package" });
  await expect(pkg).toBeVisible();
  // Sorted most-populated first: web(2) before server(1), plus the "all" reset.
  await expect(pkg.locator("option")).toContainText(["All packages", "web · 2", "server · 1"]);

  await pkg.selectOption("packages/web");
  await expect(pkg).toHaveValue("packages/web");
});

test("FR-57: the detail panel tags a node with its package", async ({ page }) => {
  await bootLiveSnapshot(page, SNAPSHOT);
  await select(page, "m:packages/server/src/index.ts");

  await expect(page.getByTestId("detail-body")).toBeVisible();
  const chip = page.getByTestId("node-package");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("server");
});

test("FR-57: a single-package (flat) repo shows no package filter", async ({ page }) => {
  await bootLiveSnapshot(page, SINGLE_PACKAGE);
  await expect(page.getByRole("combobox", { name: "Package" })).toHaveCount(0);
});

test("FR-57: colour-by-package persistently tints nodes and switches the legend", async ({
  page,
}) => {
  await bootLiveSnapshot(page, SNAPSHOT);

  // The kind legend is the default; the package "Colour" toggle appears for ≥2 packages.
  await expect(page.getByRole("img", { name: "Legend: node colours by kind" })).toBeVisible();
  const toggle = page.getByRole("button", { name: "Colour" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // Turn it on — the legend switches to packages (chrome over either surface).
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const legend = page.getByRole("img", { name: "Legend: node colours by package" });
  await expect(legend).toBeVisible();
  await expect(legend.getByText("web")).toBeVisible();
  await expect(legend.getByText("server")).toBeVisible();

  // Switch to 3D and assert the persistent per-package tint via __overlay3d: the two
  // web modules share one tint, the server module a different one — both are package
  // tints (a recessive base), not the shared module kind colour.
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();

  await expect
    .poll(() => overlay3d(page, "m:packages/web/src/app.ts"), { timeout: 15_000 })
    .toBe(WEB_TINT);
  expect(await overlay3d(page, "m:packages/web/src/util.ts")).toBe(WEB_TINT);
  expect(await overlay3d(page, "m:packages/server/src/index.ts")).toBe(SERVER_TINT);

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/fr57-packages.png",
  });
});
