import { test, expect } from "@playwright/test";

// FR-35 export keystone: the landing route must (1) export to a standalone HTML
// file that boots under an arbitrary non-root mount (mount-agnostic relative
// assets, like the explorer), and (2) be SOURCE-BLIND — a marketing page that
// bundles NO graph snapshot, NO source sidecar, NO absolute host path (AD-14).
// These run against the BUILT out/ served under /out/ (playwright.export.config.ts).

const isIgnorableError = (text: string): boolean => /favicon\.ico/.test(text);

test("the landing route exports with mount-agnostic relative assets", async ({ request }) => {
  const html = await (await request.get("./welcome.html")).text();
  // assetPrefix:"." rewrites Next assets to `./_next/…`; a root-absolute
  // `"/_next/` would 404 under a sub-path mount (and in the webview).
  expect(html).toContain("./_next/static/");
  expect(html).not.toContain('"/_next/static/');
});

test("the landing page is source-blind — no source, snapshot, or host path", async ({ request }) => {
  const html = await (await request.get("./welcome.html")).text();
  // No graph dataset / source sidecar bundled into the marketing HTML.
  expect(html).not.toContain("benchmark/");
  expect(html).not.toContain(".src/");
  // No absolute host path leaked into the static page (AD-14 / AD-16).
  expect(html).not.toContain("/Users/");
});

test("the landing page boots offline under a non-root mount", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isIgnorableError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./welcome.html");

  await expect(page.getByRole("heading", { level: 1, name: /living map/i })).toBeVisible();
  expect(errors).toEqual([]);
});
