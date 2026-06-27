// Capability-card enrichment section (Epic 4 slice 3c): renders the agent-written
// summary/intent/role for a node. Kept pure (and out of webview/main.ts, which the
// gate doesn't typecheck) so the markup — and crucially its HTML-escaping — is
// unit-tested. The text is agent-supplied and injected into innerHTML, so every
// field MUST be escaped to prevent injection.

import type { NodeEnrichment } from "../../../core/semantic/enrichment.js";

/**
 * Escape the four HTML-significant characters. Exported because every surface
 * that injects model text into innerHTML (the card here, the change feed in the
 * webview) must escape the same way — agent- and code-derived strings are
 * untrusted. Centralizing it keeps the escaping consistent and unit-tested.
 */
export function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

// A node address is `path#member`; the short name is the member (or the whole
// address when there is no `#`, e.g. a module). Used for the compact edge lists.
function shortName(addr: string): string {
  return addr.includes("#") ? (addr.split("#").pop() as string) : addr;
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

/**
 * Orphan note (FR-12, Epic 5): a calm chip flagging a node with no inbound
 * references — a dead-code *candidate*. The microcopy is deliberately hedged
 * because an orphan is just as likely a legitimate entry point (exported API,
 * main, a test root, an event handler) as it is dead code. Returns "" for a
 * node that has callers, so the chip only appears where it's informative.
 */
export function orphanNoteHtml(isOrphan: boolean | undefined): string {
  if (!isOrphan) return "";
  return (
    `<div class="orphan" ` +
    `title="No inbound references. A dead-code candidate, though it may also be an entry point.">` +
    `no callers · dead-code candidate</div>`
  );
}

/**
 * The data the capability card needs, decoupled from any graph library. The
 * webview surfaces gather this from their graphology graph and hand it here so
 * the markup — and its escaping — lives in one pure, tested place (FR-11).
 */
export interface CardView {
  readonly label: string;
  readonly kind: string;
  readonly color: string;
  readonly file: string;
  /** 0-based source line, as stored on the node; the card shows it 1-based. */
  readonly line: number;
  readonly enrichment?: NodeEnrichment;
  readonly orphan?: boolean;
  /** Out-edges grouped by relation: `[relation, full target addresses]`. */
  readonly groups: ReadonlyArray<readonly [string, readonly string[]]>;
  /** Full addresses of the nodes that reference this one. */
  readonly callers: readonly string[];
}

const EDGE_LIST_CAP = 8; // long edge lists are summarized — the header keeps the true count.

function edgeListHtml(label: string, items: readonly string[]): string {
  const lis = items
    .slice(0, EDGE_LIST_CAP)
    .map((t) => `<li>${esc(shortName(t))}</li>`)
    .join("");
  return `<div class="group"><b>${esc(label)} (${items.length})</b><ul>${lis}</ul></div>`;
}

/**
 * Build the hover capability card (FR-11): the node's identity, the agent's
 * annotation leading as the "what is this" answer, its location, its out-edges
 * grouped by relation, who calls it, and an orphan note when it has no callers.
 * Every interpolated value is escaped — addresses and agent text are untrusted.
 */
export function capabilityCardHtml(view: CardView): string {
  let html =
    `<h3>${esc(view.label)}</h3>` +
    `<span class="kind" style="color:${esc(view.color)}">${esc(view.kind)}</span>`;
  html += enrichmentSectionHtml(view.enrichment);
  html += `<div class="loc">${esc(view.file)}:${view.line + 1}</div>`;
  for (const [rel, targets] of view.groups) html += edgeListHtml(rel, targets);
  if (view.callers.length) html += edgeListHtml("used by", view.callers);
  html += orphanNoteHtml(view.orphan);
  return html;
}
