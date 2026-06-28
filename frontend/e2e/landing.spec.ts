import { test, expect } from "@playwright/test";

// FR-35 — the landing/marketing page at its own route (`/welcome`), kept off the
// `/` the VS Code webview loads. Drives the real flow on the dev server: the page
// tells the codegraph story and its primary CTA actually lands the visitor in the
// explorer. (The export/source-blind guarantees are proven separately in
// e2e/welcome-smoke.spec.ts against the built out/.)

test("the landing page presents the story and both CTAs", async ({ page }) => {
  await page.goto("/welcome");

  // Hero: the one-line value, headed and reachable by role.
  await expect(page.getByRole("heading", { level: 1, name: /living map/i })).toBeVisible();
  await expect(page.getByText(/source stays on your host/i)).toBeVisible();

  // The two-plane story — local source-host vs source-blind cloud.
  await expect(page.getByRole("heading", { name: /source-host-local/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /source-blind/i })).toBeVisible();

  // The knowledge features are all surfaced.
  for (const f of [/navigable graph/i, /diagrams & docs/i, /ask your own agent/i, /open in your editor/i]) {
    await expect(page.getByRole("heading", { name: f })).toBeVisible();
  }

  // Both CTAs are present: into the explorer (internal) and the extension (repo).
  const demo = page.getByRole("link", { name: /open the explorer demo/i }).first();
  await expect(demo).toHaveAttribute("href", "/");
  const ext = page.getByRole("link", { name: /get the vs code extension/i }).first();
  await expect(ext).toHaveAttribute("href", /github\.com\/sbeeredd04\/codegraph/);
});

test("the primary CTA lands the visitor in the explorer", async ({ page }) => {
  await page.goto("/welcome");
  await page.getByRole("link", { name: /open the explorer demo/i }).first().click();
  await expect(page).toHaveURL(/\/$/);
  // The explorer boots: Sigma paints a canvas and the header reports node counts.
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByText(/\d[\d,]* nodes/).first()).toBeVisible();
});
