import { defineConfig, devices } from "@playwright/test";

// E2E harness for the explorer (Story 8.5). Targets the DEV server on :3000 by
// design: the node-selection step drives the dev-only `__sigma` hook on the
// canvas (tree-shaken from production builds), which is the only way to fire a
// real Sigma clickNode without guessing WebGL pixel coordinates. `reuseExisting`
// means a dev server you already have running is used as-is; otherwise Playwright
// starts one (its `predev` rebuilds the precompiled core first).
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
