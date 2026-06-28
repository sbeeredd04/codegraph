import { test, expect } from "@playwright/test";

// Epic 7.4 — the unified-surface keystone: ONE static export that boots offline
// from an arbitrary mount point (a web root AND the VS Code webview's per-session
// origin). These specs run against the BUILT `out/` served under `/out/` (see
// playwright.export.config.ts), so a regression to root-absolute asset paths —
// which would break the webview — fails here.

// A 404 for the root-absolute favicon is expected under a sub-path mount (the
// favicon link is metadata, not assetPrefix-covered) and never requested by the
// webview. Everything else must be clean.
const isIgnorableError = (text: string): boolean => /favicon\.ico/.test(text);

test("the export emits relative asset paths (mount-agnostic)", async ({ request }) => {
  const html = await (await request.get("./")).text();
  // assetPrefix:"." rewrites Next assets to `./_next/…`. A root-absolute
  // `"/_next/` would resolve against the origin root and 404 inside the webview.
  expect(html).toContain("./_next/static/");
  expect(html).not.toContain('"/_next/static/');
});

test("the explorer boots fully offline under a non-root mount", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isIgnorableError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");

  // The graph renders: Sigma paints onto a canvas and the header reports counts.
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByText(/\d[\d,]* nodes/).first()).toBeVisible();

  // No app-level console errors (favicon 404 under the sub-path mount aside).
  expect(errors).toEqual([]);
});

test("the source-bearing dataset resolves against the mount base", async ({ page }) => {
  await page.goto("./");
  // Both the graph JSON and a source-sidecar file are fetched with mount-relative
  // URLs (no leading slash), so they resolve against document.baseURI === /out/.
  const result = await page.evaluate(async () => {
    const base = document.baseURI;
    const json = await fetch("benchmark/codegraph.json").then((r) => r.status);
    const src = await fetch("benchmark/codegraph.src/src/core/ports.ts").then((r) => r.status);
    return { base, json, src };
  });
  expect(result.base).toContain("/out/");
  expect(result.json).toBe(200);
  expect(result.src).toBe(200);
});
