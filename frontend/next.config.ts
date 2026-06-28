import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS app; the repo root also has a lockfile, which
  // would otherwise make Next infer the wrong root and break HMR/asset paths.
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
  // Allow importing the framework-agnostic pure core from ../src/core (the whole
  // point of the hexagonal design — one tested core, many surfaces).
  experimental: { externalDir: true },
};

export default nextConfig;
