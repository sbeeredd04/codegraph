import { defineConfig, devices } from "@playwright/test";

// Smoke harness for the PRODUCTION static export (Epic 7.4 — unified surface).
// Unlike playwright.config.ts (which drives the dev server + the dev-only
// `__sigma` hook), this serves the built `out/` under a NON-root `/out/` prefix
// via scripts/serve-export.mjs. That sub-path mount reproduces the VS Code
// webview's per-session origin: the export must resolve every asset against
// document.baseURI, never the origin root. Run `npm run test:e2e:export`, which
// builds first so the server has a fresh `out/` to serve.
const PORT = 4321;
const MOUNT_URL = `http://localhost:${PORT}/out/`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/export-smoke.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: MOUNT_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node scripts/serve-export.mjs ${PORT}`,
    url: MOUNT_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
