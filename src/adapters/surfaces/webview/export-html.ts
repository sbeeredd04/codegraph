// Epic 7.4 — embed the Next.js static export (frontend/out) into the VS Code
// webview. The export is the SAME bundle the web app serves; the webview just
// mounts it under its per-session origin and locks it behind a strict CSP.
//
// This module is pure string rewriting (no vscode, no fs) so it is unit-testable
// in isolation; the panel supplies the live baseHref / cspSource / nonce.

export interface ExportHtmlOptions {
  /**
   * Absolute, trailing-slash base that the export's relative `./_next/…` and
   * `benchmark/…` URLs resolve against — `webview.asWebviewUri(outDir)` in the
   * panel (a sub-path mount in tests). A single <base> replaces per-file URL
   * rewriting because the export already ships relative paths (assetPrefix:".").
   */
  readonly baseHref: string;
  /** The only origin assets may load from — `webview.cspSource` in the panel. */
  readonly cspSource: string;
  /** Per-load nonce; every <script> is stamped and script-src allows 'nonce-…'. */
  readonly nonce: string;
}

const HEAD_OPEN = /<head[^>]*>/i;
const ICON_LINK = /<link\b[^>]*\brel=["']?(?:shortcut )?icon["']?[^>]*>/gi;
const SCRIPT_OPEN = /<script\b/gi;

/** The webview CSP: deny-all, then open exactly what the export needs. */
function buildCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    // Lock the <base> we inject to our own origin (no base-tag escalation).
    `base-uri ${cspSource}`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    // React/Next inject inline styles; styles cannot execute, so 'unsafe-inline'
    // here is the standard, accepted tradeoff (the bespoke panel does the same).
    `style-src ${cspSource} 'unsafe-inline'`,
    // Inline hydration scripts run via the nonce; external chunks (incl. ones the
    // runtime injects dynamically) load from cspSource. No 'unsafe-eval' — the
    // production Turbopack runtime needs none.
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `connect-src ${cspSource}`,
  ].join("; ");
}

/**
 * Rewrite a Next.js static-export `index.html` into webview-ready HTML: mount it
 * under `baseHref` and enforce a strict, nonce-based CSP.
 *
 * Steps: drop the root-absolute favicon link (404s under a non-root mount and a
 * webview shows no favicon); inject `<base>` + the CSP meta immediately after
 * `<head>` so they precede the first asset/script; stamp the per-load nonce onto
 * every `<script>` so the export's inline hydration blocks are authorized.
 */
export function prepareExportHtml(indexHtml: string, opts: ExportHtmlOptions): string {
  const { baseHref, cspSource, nonce } = opts;
  const injected =
    `<base href="${baseHref}">` +
    `<meta http-equiv="Content-Security-Policy" content="${buildCsp(cspSource, nonce)}">`;

  return indexHtml
    .replace(ICON_LINK, "")
    .replace(HEAD_OPEN, (open) => `${open}${injected}`)
    .replace(SCRIPT_OPEN, `<script nonce="${nonce}" `);
}
