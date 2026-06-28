// Agent-authored knowledge diagrams — the board side (Epic 7 slice 7.4). The MCP
// server writes categorized Mermaid diagrams (save_diagram); this module turns the
// persisted DiagramSet into the render-ready model the webview drawer consumes.
//
// Kept pure (and out of webview/main.ts, which the gate doesn't typecheck) so the
// drawer's index markup — and crucially its HTML-escaping — is unit-tested. The
// titles, categories, and descriptions are agent-written and injected into
// innerHTML, so every interpolated field is escaped here. The Mermaid SOURCE is
// deliberately NOT placed in this index markup; it travels on the model and is
// handed to Mermaid's strict renderer in the webview, never to innerHTML directly.

import type { Diagram, DiagramSet } from "../../../core/diagrams/diagram.js";
import { diagramsByCategory } from "../../../core/diagrams/diagram.js";
import { esc, shortName } from "./card.js";

/** A single diagram, shaped for the webview: the chrome the index shows plus the
 * raw Mermaid source the renderer needs when the user opens it. */
export interface DiagramView {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly description?: string;
  /** Mermaid source (agent-written, untrusted) — rendered with strict security. */
  readonly mermaid: string;
  /** Graph node addresses this diagram is about (Epic 7.5 click-through). */
  readonly related?: readonly string[];
}

export interface DiagramCategoryGroup {
  readonly category: string;
  readonly diagrams: readonly DiagramView[];
}

/** Render-ready diagram panel: total count (drives the toggle) + category groups. */
export interface DiagramPanelModel {
  readonly count: number;
  readonly groups: readonly DiagramCategoryGroup[];
}

const toView = (d: Diagram): DiagramView => ({
  id: d.id,
  title: d.title,
  category: d.category,
  mermaid: d.mermaid,
  ...(d.description ? { description: d.description } : {}),
  ...(d.related ? { related: d.related } : {}),
});

/** Group a repo's diagrams by category (first-seen order) into the panel model. */
export function buildDiagramPanel(set: DiagramSet): DiagramPanelModel {
  const groups: DiagramCategoryGroup[] = [];
  for (const [category, diagrams] of diagramsByCategory(set)) {
    groups.push({ category, diagrams: diagrams.map(toView) });
  }
  return { count: set.diagrams.length, groups };
}

// Why an empty state and not a hidden drawer: a repo with no diagrams yet is the
// common first-run case, and a blank panel reads as broken. This tells the human
// exactly how diagrams appear — their connected agent calls save_diagram — which
// is the onboarding moment for the whole feature.
function emptyStateHtml(): string {
  return (
    `<div class="dg-empty">` +
    `<p class="dg-empty-title">No diagrams yet</p>` +
    `<p class="dg-empty-body">Connect your AI agent over MCP and ask it to map this repo. ` +
    `As it explores the graph it calls <code>save_diagram</code> to author workflow, ` +
    `architecture, and sequence diagrams — they appear here.</p>` +
    `</div>`
  );
}

function itemHtml(d: DiagramView): string {
  const desc = d.description ? `<span class="dg-desc">${esc(d.description)}</span>` : "";
  return (
    `<button class="dg-item" type="button" data-id="${esc(d.id)}">` +
    `<span class="dg-title">${esc(d.title)}</span>${desc}` +
    `</button>`
  );
}

function groupHtml(group: DiagramCategoryGroup): string {
  const items = group.diagrams.map(itemHtml).join("");
  return (
    `<section class="dg-group">` +
    `<h4 class="dg-cat">${esc(group.category)}<span class="dg-n">${group.diagrams.length}</span></h4>` +
    `${items}</section>`
  );
}

/**
 * The drawer's index: one section per category, a button per diagram (tagged with
 * its id so the webview can look the source up and render it). Every interpolated
 * value is escaped — agent text is untrusted. An empty set yields an onboarding
 * empty state, never a blank panel.
 */
export function diagramIndexHtml(model: DiagramPanelModel): string {
  if (model.count === 0) return emptyStateHtml();
  return model.groups.map(groupHtml).join("");
}

/**
 * The clickable "related nodes" chips for an open diagram (Epic 7.5c): one button
 * per graph address the diagram is about, so the user can jump from the narrative
 * straight to the node in the graph. The address is carried on `data-addr` (the
 * surface focuses it) and shown as a compact label. Returns "" when there are
 * none, so the chip row simply stays hidden. Addresses are agent-written and go
 * into innerHTML, so both the attribute and the label are escaped.
 */
export function relatedChipsHtml(addresses: readonly string[] | undefined): string {
  if (!addresses || addresses.length === 0) return "";
  const chips = addresses
    .map(
      (a) =>
        `<button class="dg-rel" type="button" data-addr="${esc(a)}" title="${esc(a)}">` +
        `${esc(shortName(a))}</button>`,
    )
    .join("");
  return `<span class="dg-rel-label">Related</span>${chips}`;
}
