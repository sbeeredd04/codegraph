import { test, expect } from "@playwright/test";

// FR-28 under the webview's constraints — the load-bearing proof for this slice.
// Mermaid is a heavyweight dependency; this verifies it renders a diagram inside
// the production static export served under a strict nonce CSP (no 'unsafe-eval',
// no 'unsafe-inline' scripts) and a non-root mount. If mermaid (or its
// dynamically-imported chunk) needed eval or an un-nonced inline script, the CSP
// would block it and this spec would fail — exactly the regression the bespoke
// webview's vendored mermaid avoided, now proven for the bundled path too.

const isCspViolation = (text: string): boolean => /Refused to|Content Security Policy/i.test(text);

test("a Mermaid diagram renders under the strict nonce CSP with zero violations", async ({ page }) => {
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
  await expect(page.locator("canvas").first()).toBeVisible();

  // Switch to the source-bearing self-portrait, which carries seeded diagrams.
  await page.getByLabel("Dataset").selectOption("codegraph");
  await expect(page.getByRole("button", { name: /Diagrams\s*4/ })).toBeVisible();

  // Open the drawer and render a diagram — mermaid loads (dynamic import chunk)
  // and produces an SVG, all under the strict CSP.
  await page.getByRole("button", { name: /Diagrams/ }).click();
  await expect(page.locator('[data-testid="diagram-svg"] svg')).toBeVisible({ timeout: 20_000 });

  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
