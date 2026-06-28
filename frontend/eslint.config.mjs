import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Precompiled core (generated) and the source-viewer sample sidecar (copied
    // first-party .ts assets served statically — not part of the app's lint set).
    "vendor/**",
    "public/benchmark/**",
    // Playwright E2E harness + its outputs (Story 8.5) — not part of the app lint set.
    "e2e/**",
    "playwright.config.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
