// Shared, CSP-safe Mermaid rendering (T13 — full Markdown + Mermaid everywhere).
// The ONE place that dynamic-imports mermaid, applies the strict security config,
// and renders a diagram source to a sanitized SVG string. Reused by the diagrams
// drawer, the first-party docs website, and (next) the agent docs drawer — so the
// strict config lives in a single source of truth:
//   securityLevel:"strict" → mermaid DOMPurify-sanitizes its own SVG output and
//   emits no <script>/eval, which is what keeps it clean under the webview's strict
//   nonce CSP (proven by the board's diagram CSP smoke).
// Mermaid is dynamic-imported so it stays client-only and off every boot path until
// a diagram is actually rendered — pages with no diagrams never load the chunk.

let initialized = false;
let seq = 0;

/**
 * Render one Mermaid source to a strict, CSP-safe SVG string. Client-only (it
 * touches the DOM via mermaid). Throws if the source fails to parse — callers
 * should keep the raw source visible on failure rather than showing a blank box.
 */
export async function renderMermaid(source: string): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      fontFamily: "var(--font-sans, ui-sans-serif), system-ui, sans-serif",
    });
    initialized = true;
  }
  // Ids must be DOM-safe and unique per render; a monotonic counter suffices.
  const { svg } = await mermaid.render(`cg-mmd-${seq++}`, source);
  return svg;
}
