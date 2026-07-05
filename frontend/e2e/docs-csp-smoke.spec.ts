import { test, expect } from "@playwright/test";

// FR-29 under the webview's constraints. The docs drawer parses untrusted agent
// Markdown (marked) and sanitizes it (DOMPurify) before injecting it. This proves
// that whole path runs inside the production static export served under a strict
// nonce CSP (no 'unsafe-eval', no 'unsafe-inline' scripts) at a non-root mount:
// the dynamically-imported marked/dompurify chunks load and render with zero CSP
// violations. If either needed eval or an un-nonced inline script, the CSP would
// block it and this spec would fail.

const isCspViolation = (text: string): boolean => /Refused to|Content Security Policy/i.test(text);

test("sanitized Markdown renders under the strict nonce CSP with zero violations", async ({ page }) => {
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

  await page.getByLabel("Dataset").selectOption("codegraph");
  await expect(page.getByRole("button", { name: /Docs\s*2/ })).toBeVisible();

  await page.getByRole("button", { name: /Docs/ }).click();
  // A GFM table proves marked parsed and DOMPurify kept the structured prose.
  await expect(page.locator('[data-testid="doc-html"] table')).toBeVisible({ timeout: 20_000 });
  // T13.2: an inline ```mermaid fence in the same agent doc also renders to a strict
  // SVG under the strict nonce CSP — mermaid dynamic-imports and renders with no eval
  // and no un-nonced inline script, so zero CSP violations below.
  await expect(page.locator('[data-testid="doc-mermaid"] svg')).toBeVisible({ timeout: 20_000 });

  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
