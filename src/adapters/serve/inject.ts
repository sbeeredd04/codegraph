import type { GraphSnapshot } from "../../core/graph/export.js";

// FR-88 — local serve injection. `codegraph serve` (the npx one-liner) hands the
// SAME static board the VS Code webview and the website render, but there's no
// VS Code host to post the live graph. So we rewrite the served index.html to
// stub `acquireVsCodeApi` (which makes the board treat itself as a live host and
// wait for a snapshot instead of loading the bundled sample) and reply to the
// board's ready ping with the scanned snapshot — exactly the host handshake in
// explorer-panel.ts, but inline. Host-local + read-only: this runs on the user's
// machine where the source already lives (AD-16), so keeping doc/examples is fine.

/**
 * Serialize a value for embedding inside an inline `<script>`. Escapes `<`, `>`,
 * and `&` so a `</script>` or `<!--` inside string data (a node name, a path)
 * cannot break out of the script element — the standard JSON-in-HTML hardening.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Rewrite the export's index.html so the board receives `snapshot` on load. Inserts
 * a boot script right after `<head>` (before the app bundle) that:
 *   1. defines `window.acquireVsCodeApi` → a stub, so `isWebviewHost()` is true and
 *      the board waits for a live graph rather than loading its sample;
 *   2. replies to the board's `codegraph:ready` ping with the snapshot (the host
 *      handshake), with a post-mount fallback if the ping is ever missed.
 * `editorRoot` (the scanned absolute root) rides along so FR-32 "open in editor"
 * deep links work on the local plane. Returns the html unchanged-shaped otherwise.
 */
export function injectSnapshot(html: string, snapshot: GraphSnapshot, editorRoot?: string): string {
  const message = {
    type: "codegraph:snapshot",
    snapshot,
    ...(editorRoot ? { editorRoot } : {}),
  };
  const boot = [
    "<script>(function(){",
    `  var MSG = ${jsonForScript(message)};`,
    "  var delivered = false;",
    "  function deliver(){ delivered = true; window.postMessage(MSG, '*'); }",
    "  var api = {",
    "    postMessage: function(m){ if (m && m.type === 'codegraph:ready') deliver(); },",
    "    getState: function(){ return undefined; },",
    "    setState: function(){}",
    "  };",
    "  window.acquireVsCodeApi = function(){ return api; };",
    "  // Fallback: deliver after mount if the board never announced readiness.",
    "  window.addEventListener('DOMContentLoaded', function(){",
    "    setTimeout(function(){ if (!delivered) deliver(); }, 400);",
    "  });",
    "})();</script>",
  ].join("\n");
  if (html.includes("<head>")) return html.replace("<head>", `<head>\n${boot}`);
  return `${boot}\n${html}`;
}
