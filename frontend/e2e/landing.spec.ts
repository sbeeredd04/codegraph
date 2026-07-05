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

test("T12.1: the Get started section explains install + setup across the three surfaces", async ({ page }) => {
  await page.goto("/welcome");

  // The nav offers a jump to the install section, and the section itself is headed.
  await expect(page.getByRole("navigation").getByRole("link", { name: /get started/i })).toHaveAttribute(
    "href",
    "#get-started",
  );
  await expect(page.getByRole("heading", { name: /^get started$/i })).toBeVisible();

  // The copy-pasteable quickstart shows the honest from-source path that works today.
  const section = page.locator("#get-started");
  await expect(section.getByText("git clone https://github.com/sbeeredd04/codegraph")).toBeVisible();
  await expect(section.getByText(/npm install && npm run build && npm link/)).toBeVisible();

  // All three surfaces (a terminal, the editor, the agent) are surfaced with a command.
  for (const s of [/CLI \+ web board/i, /VS Code extension/i, /Connect your agent/i]) {
    await expect(section.getByRole("heading", { name: s })).toBeVisible();
  }
  await expect(section.getByText("codegraph skill --install")).toBeVisible();

  // It's honest that the one-line installers are still pre-release.
  await expect(section.getByText(/pre-1\.0/i)).toBeVisible();

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/landing-get-started.png",
    fullPage: true,
  });
});

test("T12.3: the hero offers a jump to install, and prerequisites precede the quickstart", async ({ page }) => {
  await page.goto("/welcome");

  // A tertiary hero affordance keeps the from-source install reachable above the fold,
  // anchoring to the install section far below (no third loud CTA in the button row).
  const heroInstall = page.getByRole("link", { name: /install & setup/i });
  await expect(heroInstall).toHaveAttribute("href", "#get-started");

  // Prerequisites are stated before the quickstart so expectations are set up front.
  const reqs = page.getByTestId("prerequisites");
  await expect(reqs.getByText(/^Requirements$/)).toBeVisible();
  await expect(reqs.getByText("Node 20+")).toBeVisible();
  await expect(reqs.getByText("git", { exact: true })).toBeVisible();
  await expect(reqs.getByText(/python/i)).toBeVisible();
});
