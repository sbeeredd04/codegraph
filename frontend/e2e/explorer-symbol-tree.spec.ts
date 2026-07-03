import { test, expect, type Page } from "@playwright/test";

// FR-75 — the package→file→symbol tree dock. A browsable outline of the codebase
// (packages → files → functions/classes) that complements the fuzzy ⌘K jump: open
// it from the "Symbols" toolbar button, filter to narrow, expand a file to its
// symbols, and click a symbol to jump to it. Packages are first-class (a Focus
// control frames the package region). Runs on the dev server (`__sigma` ready).

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

test("FR-75: the symbol tree opens, filters, and jumps to a symbol", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // Open the tree from the toolbar (renamed distinct from the "Rescan" action).
  await page.getByRole("button", { name: "Symbols" }).click();
  await expect(page.getByRole("dialog", { name: "Symbol tree" })).toBeVisible();
  await expect(page.getByTestId("symbol-tree")).toBeVisible();

  // The codebase partitions into at least one package (tRPC is a monorepo).
  await expect(page.getByTestId("tree-package").first()).toBeVisible();

  // Filtering narrows the tree in place and auto-expands matches → symbols appear.
  await page.getByTestId("tree-filter").fill("client");
  await expect(page.getByTestId("tree-file").first()).toBeVisible();
  const symbols = page.getByTestId("tree-symbol");
  await expect(symbols.first()).toBeVisible();
  await page.screenshot({ path: `${SHOT}/symbol-tree.png` });

  // Clicking a symbol jumps to it — the detail inspector opens on that node.
  await symbols.first().click();
  await expect(page.getByTestId("detail-body")).toBeVisible();
});

test("FR-75: a package row focuses its region on the board (packages first-class)", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  await page.getByRole("button", { name: "Symbols" }).click();
  await expect(page.getByTestId("symbol-tree")).toBeVisible();

  // The Focus control on a package frames its region on the board. On success the
  // control flips to a pressed "Clear focus on <pkg>" toggle (so re-locate by that
  // name — the original "Focus …" label is gone).
  const focusBtn = page.getByRole("button", { name: /Focus .* on the board/ }).first();
  const label = (await focusBtn.getAttribute("aria-label")) ?? "";
  const pkg = /Focus (.*) on the board/.exec(label)?.[1] ?? "";
  expect(pkg.length).toBeGreaterThan(0);
  await focusBtn.click();

  const clearBtn = page.getByRole("button", { name: `Clear focus on ${pkg}` });
  await expect(clearBtn).toBeVisible();
  await expect(clearBtn).toHaveAttribute("aria-pressed", "true");
  // The toolbar package filter reflects the same focus (single source of truth).
  await expect(page.getByRole("combobox", { name: "Package" })).not.toHaveValue("");
});
