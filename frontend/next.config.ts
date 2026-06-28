import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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
  // output:export ships no Next image-optimization server.
  images: { unoptimized: true },
};

export default nextConfig;
