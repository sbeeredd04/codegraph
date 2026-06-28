import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Phase-gated so the dev server (and the Playwright E2E harness it backs) keeps
// absolute `/_next/` URLs — a relative assetPrefix only matters for the exported
// bundle that has to mount under an arbitrary, per-session origin.
const config = (phase: string): NextConfig => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  const nextConfig: NextConfig = {
    // Pin the workspace root to THIS app. The pure core is consumed as precompiled
    // ESM under ./vendor/core (see ../tsconfig.frontend-core.json + the build:core
    // script), so the app no longer imports ../src directly — the root can stay the
    // app dir, which also silences the two-lockfile root inference.
    turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
    // Allow loopback hosts to load dev resources (Next 16 blocks cross-origin dev
    // requests by default; 127.0.0.1 vs localhost otherwise breaks HMR + chunks).
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    // Static export: the SAME build serves as a standalone web app AND loads into
    // the VS Code webview (no server, CSP-friendly). This is the "unified Next.js
    // frontend for both surfaces" decision.
    output: "export",
    // Emit `./_next/...` instead of root-absolute `/_next/...` so the exported
    // bundle resolves against a `<base href>` regardless of mount point — a web
    // root (relative to index.html === `/`) OR the VS Code webview's dynamic
    // `vscode-webview://<uuid>/…` origin (the later panel slice sets the base via
    // asWebviewUri). Dev keeps absolute paths (assetPrefix undefined).
    assetPrefix: isDev ? undefined : ".",
    // output:export ships no Next image-optimization server.
    images: { unoptimized: true },
  };

  return nextConfig;
};

export default config;
