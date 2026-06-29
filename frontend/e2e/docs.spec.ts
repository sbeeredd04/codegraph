import { test, expect } from "@playwright/test";

// The /docs section — first-party guide pages (getting started, how it works, how
// to use), authored in Markdown and rendered to HTML at build time. Drives the
// real flow on the dev server; the export/source-blind guarantees are proven
// separately in e2e/docs-site-smoke.spec.ts against the built out/.

test("the docs index lists the guides and links into each", async ({ page }) => {
  await page.goto("/docs");

  await expect(page.getByRole("heading", { level: 1, name: /documentation/i })).toBeVisible();

  // All three guides surfaced as cards.
  for (const t of [/getting started/i, /how it works/i, /how to use it/i]) {
    await expect(page.getByRole("heading", { name: t })).toBeVisible();
  }

  // Guides live at the export root (no /docs/ prefix) so their relative assets stay
  // mount-agnostic for the webview + web sub-path.
  await expect(page.getByRole("link", { name: /getting started/i }).first()).toHaveAttribute(
    "href",
    "/getting-started",
  );
});

test("a guide page renders its Markdown and the sidebar marks it active", async ({ page }) => {
  await page.goto("/getting-started");

  // Build-time-rendered Markdown: the H1 from the .md frontmatter body is present.
  await expect(page.getByRole("heading", { level: 1, name: /getting started/i })).toBeVisible();
  // A known phrase from the body proves the Markdown actually rendered.
  await expect(page.getByText(/no LLM key/i).first()).toBeVisible();

  // The sidebar nav marks the current guide active (aria-current=page).
  const active = page.locator('nav[aria-label="Docs"] a[aria-current="page"]');
  await expect(active).toHaveText(/getting started/i);

  // The cross-link to another guide resolves to the flat root URL.
  await expect(page.getByRole("link", { name: /how to use it/i }).first()).toHaveAttribute(
    "href",
    "/how-to-use",
  );
});

test("the landing page links into the docs", async ({ page }) => {
  await page.goto("/welcome");
  const docsLink = page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: /^docs$/i });
  await expect(docsLink).toHaveAttribute("href", "/docs");
  await docsLink.click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { level: 1, name: /documentation/i })).toBeVisible();
});
