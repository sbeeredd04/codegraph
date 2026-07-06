import { test, expect } from "@playwright/test";

// T14.6 export keystone: the /benchmark marketing route must (1) export to a
// standalone HTML file that boots under an arbitrary non-root mount (mount-agnostic
// relative assets, like the landing + docs), and (2) be SOURCE-BLIND — a static
// results page that bundles NO graph snapshot, NO source sidecar, NO absolute host
// path (AD-14). Runs against the BUILT out/ served under /out/ (export config).

const isIgnorableError = (text: string): boolean => /favicon\.ico/.test(text);

test("the benchmark route exports with mount-agnostic relative assets", async ({ request }) => {
  const html = await (await request.get("./benchmark.html")).text();
  expect(html).toContain("./_next/static/");
  expect(html).not.toContain('"/_next/static/');
});

test("the benchmark page is source-blind — no source, snapshot, or host path", async ({ request }) => {
  const html = await (await request.get("./benchmark.html")).text();
  // The page reports measured numbers only — never the source it was measured over.
  expect(html).not.toContain(".src/");
  expect(html).not.toContain("/Users/");
  // No graph dataset embedded (the page is hand-authored constants, not a snapshot).
  expect(html).not.toContain('"nodes":');
  expect(html).not.toContain('"edges":');
});

test("the benchmark page boots offline under a non-root mount, honest content intact", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isIgnorableError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./benchmark.html");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/makes it certain/i);
  // The honest non-wins survive the export too.
  await expect(page.getByText("overhead").first()).toBeVisible();
  await expect(page.getByText("tie").first()).toBeVisible();
  expect(errors).toEqual([]);
});
