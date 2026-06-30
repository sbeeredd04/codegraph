import { test, expect } from "@playwright/test";

// FR-70 under the webview's constraints — the load-bearing proof for the source
// surface. CodeMirror 6 is the deliberate choice over Monaco precisely because of
// this test: Monaco needs eval / blob workers that the strict no-eval webview CSP
// forbids, whereas CM6 is eval-free and injects its styles as inline <style> (which
// `style-src 'unsafe-inline'` permits) while its chunk loads as a same-origin
// <script> (allowed by `script-src 'self' nonce-…`). This boots the editor inside
// the production static export served under that strict nonce CSP, at a non-root
// mount, and asserts ZERO CSP violations / page errors.
//
// The dev __sigma hook is tree-shaken in production, so we drive selection the way a
// user would: switch to the source-bearing codegraph dataset, open the ⌘K palette,
// jump to a node whose file resolves in the sidecar, then open its source.

const isCspViolation = (text: string): boolean => /Refused to|Content Security Policy/i.test(text);

test("the CodeMirror source surface boots under the strict nonce CSP with zero violations", async ({
  page,
}) => {
  const violations: string[] = [];
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") {
      if (isCspViolation(m.text())) violations.push(m.text());
      else if (!/favicon/.test(m.text())) errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("webview.html");
  // Boot lands on the 2D Sigma surface.
  await expect(page.locator('[data-surface="2d"] canvas, canvas').first()).toBeVisible();

  // Switch to the dataset that ships source (sourceBase = benchmark/codegraph.src) and
  // wait for the graph to actually rebuild — the header node-count flips to its size.
  const count = page.getByText(/\d[\d,]* nodes/).first();
  const before = await count.textContent();
  await page.getByRole("combobox", { name: "Dataset" }).selectOption("codegraph");
  await expect.poll(async () => (await count.textContent()) !== before, { timeout: 30_000 }).toBe(true);

  // Jump to a node with resolvable source via the palette (no __sigma in production).
  await page.getByRole("button", { name: "Search nodes" }).click();
  const search = page.getByRole("combobox", { name: "Search nodes by name" });
  await expect(search).toBeVisible();
  await search.fill("src/extension/index.ts");
  const options = page.getByRole("listbox", { name: "Nodes" }).getByRole("option");
  await expect(options.first()).toBeVisible();
  await search.press("Enter");

  // Open the source surface → mounts the dynamic CM6 chunk under the strict CSP.
  await page.getByRole("button", { name: "View source" }).click();
  const region = page.getByRole("region", { name: /Source for/ });
  await expect(region).toBeVisible();

  // The editor genuinely mounted (not the source-blind fallback) and rendered the
  // file: a CM6 instance with a gutter and the node's def line marked.
  await expect(region.getByTestId("source-unavailable")).toHaveCount(0);
  await expect(region.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
  await expect(region.locator(".cm-gutters")).toBeVisible();
  await expect(region.locator(".cm-defline")).toHaveCount(1);

  // The whole point: CM6 booted under the strict no-eval nonce CSP with nothing refused.
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
