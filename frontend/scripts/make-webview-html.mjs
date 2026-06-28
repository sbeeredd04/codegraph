// Generate out/webview.html — a webview-simulated copy of the static export,
// mounted under a <base> and locked behind the SAME strict nonce CSP the VS Code
// panel will apply (src/adapters/surfaces/webview/export-html.ts). The Playwright
// spec e2e/webview-csp-smoke.spec.ts loads it under a non-root /out/ mount with
// the CSP enforced, empirically proving the export boots with no eval / no inline
// script execution — the keystone risk for Epic 7.4.
//
// This mirrors prepareExportHtml; it is a verification fixture, not product code.
// `'self'` stands in for webview.cspSource (the webview's own origin), and a
// relative `./` base resolves to the served /out/ directory.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out");

const NONCE = "smoketestnonce";
const CSP = [
  "default-src 'none'",
  "base-uri 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'nonce-${NONCE}'`,
  "connect-src 'self'",
].join("; ");

const indexHtml = await readFile(join(out, "index.html"), "utf8");
const injected = `<base href="./"><meta http-equiv="Content-Security-Policy" content="${CSP}">`;

const webviewHtml = indexHtml
  .replace(/<link\b[^>]*\brel=["']?(?:shortcut )?icon["']?[^>]*>/gi, "")
  .replace(/<head[^>]*>/i, (open) => `${open}${injected}`)
  .replace(/<script\b/gi, `<script nonce="${NONCE}" `);

await writeFile(join(out, "webview.html"), webviewHtml);
process.stdout.write("wrote out/webview.html (webview-simulated, strict CSP)\n");
