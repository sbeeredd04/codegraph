import type { GraphSnapshot } from "../../core/graph/export.js";

// FR-88 — local serve injection. `codegraph serve` (the npx one-liner) hands the
// SAME static board the VS Code webview and the website render, but there's no
// VS Code host to post the live graph. So we rewrite the served index.html to
// stub `acquireVsCodeApi` (which makes the board treat itself as a live host and
// wait for a snapshot instead of loading the bundled sample) and reply to the
// board's ready ping with the scanned snapshot — exactly the host handshake in
// explorer-panel.ts, but inline. Host-local + read-only: this runs on the user's
// machine where the source already lives (AD-16), so keeping doc/examples is fine.

// U+2028 / U+2029 built from code points so no raw line terminator sits in this source
// file. Both are legal in JSON strings but are raw line breaks in a JS string literal.
const JS_LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);
const JS_LINE_SEPARATOR_RE = new RegExp("[" + JS_LINE_SEPARATORS + "]", "g");

/**
 * Serialize a value for embedding inside an inline `<script>`. Two hazards, both from
 * string data that could carry arbitrary bytes (a node name, a path, a docstring):
 *   - `<`, `>`, `&` — escaped so a `</script>` or `<!--` can't break out of the script
 *     element (the standard JSON-in-HTML hardening);
 *   - U+2028 / U+2029 — legal inside a JSON string but RAW LINE TERMINATORS in a JS
 *     string literal, so an unescaped one would make the boot script a syntax error and
 *     white-screen the board. `JSON.stringify` leaves them raw, so we escape them here.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(JS_LINE_SEPARATOR_RE, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
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
