import { test, expect } from "@playwright/test";

// Export keystone for the docs section: every guide page must (1) export to a
// standalone, root-level HTML file whose assets are mount-agnostic (relative
// `./_next/…`, like the explorer + landing), so it boots under an arbitrary
// non-root mount AND the VS Code webview origin, and (2) be SOURCE-BLIND — a
// content page that bundles NO graph snapshot, NO source, NO absolute host path
// (AD-14). These run against the BUILT out/ served under /out/.

const GUIDES = ["docs", "getting-started", "how-it-works", "how-to-use"] as const;
const isIgnorableError = (text: string): boolean => /favicon\.ico/.test(text);

for (const page of GUIDES) {
  test(`/${page} exports with mount-agnostic relative assets`, async ({ request }) => {
    const html = await (await request.get(`./${page}.html`)).text();
    // Root-level emission: assets are `./_next/…`, never root-absolute `/_next/…`
    // (which would 404 under a sub-path mount and in the webview).
    expect(html).toContain("./_next/static/");
    expect(html).not.toContain('"/_next/static/');
  });

  test(`/${page} is source-blind — no source, snapshot, or host path`, async ({ request }) => {
    const html = await (await request.get(`./${page}.html`)).text();
    expect(html).not.toContain("benchmark/");
    expect(html).not.toContain(".src/");
    // No absolute host path leaked into the static page (AD-14 / AD-16).
    expect(html).not.toContain("/Users/");
  });
}

test("a guide page boots offline under a non-root mount with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isIgnorableError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./getting-started.html");

  await expect(page.getByRole("heading", { level: 1, name: /getting started/i })).toBeVisible();
  expect(errors).toEqual([]);
});

// T13.1 — an embedded ```mermaid diagram must render to an SVG in the BUILT export,
// offline, under the non-root mount: the DocsMermaid enhancer hydrates and the
// dynamically-imported mermaid chunk resolves against document.baseURI (not the
// origin root), with no console errors. Proves Mermaid-in-Markdown works everywhere
// the static docs are served (web sub-path + VS Code webview origin).
test("an embedded Mermaid diagram renders to an SVG in the export", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isIgnorableError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./how-it-works.html");

  const diagram = page.locator(".cg-mermaid").first();
  await expect(diagram.locator("svg")).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
