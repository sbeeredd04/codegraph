import { test, expect, type Page } from "@playwright/test";

// FR-74 — fast, kind-scoped code lookup. The ⌘K palette gains: a `fn:`/`file:`/
// `class:`/`method:`/`flow:` prefix that scopes results to that kind (shown as a
// removable chip), and a secondary PATH line per row so same-named symbols are
// distinguishable and you can see WHERE a symbol lives without opening it. Runs on
// the dev server (the `__sigma` ready hook) against the default codegraph dataset.

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

test("FR-74: ⌘K scopes by kind and shows each result's file path", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // Open the node palette (⌘K / Ctrl+K).
  await page.keyboard.press("ControlOrMeta+KeyK");
  const dialog = page.getByRole("dialog", { name: "Search nodes" });
  await expect(dialog).toBeVisible();

  const input = page.getByRole("combobox", { name: "Search nodes by name" });

  // Unscoped: rows already carry a file-path secondary line (distinguishes symbols).
  await input.fill("index");
  await expect(page.getByTestId("result-path").first()).toBeVisible();
  const anyPath = await page.getByTestId("result-path").first().textContent();
  expect(anyPath && anyPath.length).toBeTruthy();

  // Scope to functions with the `fn:` prefix — a removable chip appears and EVERY
  // result is a function.
  await input.fill("fn:");
  const scope = page.getByTestId("palette-scope");
  await expect(scope).toBeVisible();
  await expect(scope).toContainText("functions");

  const kinds = page.getByTestId("result-kind");
  await expect(kinds.first()).toBeVisible();
  const kindTexts = await kinds.allTextContents();
  expect(kindTexts.length).toBeGreaterThan(0);
  expect(kindTexts.every((k) => k === "function")).toBe(true);
  await page.screenshot({ path: `${SHOT}/search-fn-scope.png` });

  // A `file:` scope flips the result set to modules only.
  await input.fill("file:");
  await expect(scope).toContainText("files");
  const fileKinds = await page.getByTestId("result-kind").allTextContents();
  expect(fileKinds.length).toBeGreaterThan(0);
  expect(fileKinds.every((k) => k === "module")).toBe(true);

  // Clearing the scope chip drops back to an unscoped search (mixed kinds return).
  await page.getByRole("button", { name: /Clear files filter/ }).click();
  await expect(scope).toHaveCount(0);
});
