import { defineConfig, configDefaults } from "vitest/config";

// The root vitest run covers the pure core + adapters under src/. The Next.js app
// in frontend/ ships its own Playwright harness (frontend/e2e/*.spec.ts), whose
// `@playwright/test` files must not be collected here — vitest cannot run them and
// they have their own runner (`npm --prefix frontend run test:e2e[:export]`).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "frontend/**"],
  },
});
