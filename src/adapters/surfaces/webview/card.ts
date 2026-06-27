// Capability-card enrichment section (Epic 4 slice 3c): renders the agent-written
// summary/intent/role for a node. Kept pure (and out of webview/main.ts, which the
// gate doesn't typecheck) so the markup — and crucially its HTML-escaping — is
// unit-tested. The text is agent-supplied and injected into innerHTML, so every
// field MUST be escaped to prevent injection.

import type { NodeEnrichment } from "../../../core/semantic/enrichment.js";

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

/**
 * The card's enrichment block: the summary as the lead "what is this" line, the
 * role as a quiet pill, and intent as supporting text. Returns "" when there is
 * no summary, so an un-annotated node shows nothing. The accent-tinted container
 * (styled in panel.ts) signals this is an AI-written annotation, not ground truth.
 */
export function enrichmentSectionHtml(enrichment: NodeEnrichment | undefined): string {
  if (!enrichment || !enrichment.summary.trim()) return "";
  const role = enrichment.role.trim()
    ? `<div class="enrich-head"><span class="role">${esc(enrichment.role)}</span></div>`
    : "";
  const intent = enrichment.intent.trim() ? `<p class="intent">${esc(enrichment.intent)}</p>` : "";
  return `<div class="enrich">${role}<p class="summary">${esc(enrichment.summary)}</p>${intent}</div>`;
}
