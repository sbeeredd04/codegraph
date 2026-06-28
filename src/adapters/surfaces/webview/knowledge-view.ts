// The knowledge index — the repo's table of contents (PM-backlog #4). It folds the
// two things the agent authors over MCP (annotations via annotate_node, diagrams
// via save_diagram) into one navigable model: annotated nodes grouped by their
// architectural role, and diagrams grouped by category. This is the surface that
// "bridges the knowledge gap" — the graph is structure, this is the narrative the
// agent has captured, browsable in one place instead of one hover at a time.
//
// Kept pure (and out of the webview glue, which the gate doesn't typecheck) so the
// index markup — and crucially its HTML-escaping — is unit-tested. Roles, summaries,
// and titles are agent-written and injected into innerHTML, so every interpolated
// field is escaped here.

import type { GraphNode, NodeKind } from "../../../core/graph/types.js";
import type { NodeEnrichment } from "../../../core/semantic/enrichment.js";
import type { DiagramSet } from "../../../core/diagrams/diagram.js";
import { diagramsByCategory } from "../../../core/diagrams/diagram.js";
import { esc } from "./card.js";

/** One annotated node, shaped for the index: enough to show and to focus on click. */
export interface KnowledgeNodeEntry {
  readonly address: string;
  readonly name: string;
  readonly kind: NodeKind;
  readonly summary: string;
}

/** Annotated nodes sharing an architectural role (the agent's own classification). */
export interface KnowledgeRoleGroup {
  readonly role: string;
  readonly entries: readonly KnowledgeNodeEntry[];
}

/** One diagram, shaped for the index: its id (to deep-link the diagrams drawer) + title. */
export interface KnowledgeDiagramEntry {
  readonly id: string;
  readonly title: string;
}

export interface KnowledgeDiagramGroup {
  readonly category: string;
  readonly diagrams: readonly KnowledgeDiagramEntry[];
}

/** Render-ready knowledge index: coverage counts + the two grouped sections. */
export interface KnowledgeIndexModel {
  /** How many nodes carry an annotation (drives the coverage line + the toggle badge). */
  readonly annotatedCount: number;
  /** Total nodes in the graph, so the human can see annotation coverage. */
  readonly totalNodes: number;
  readonly diagramCount: number;
  readonly roleGroups: readonly KnowledgeRoleGroup[];
  readonly diagramGroups: readonly KnowledgeDiagramGroup[];
}

const ROLE_FALLBACK = "Unclassified";

/**
 * Fold the graph's nodes, their annotations, and the diagram set into the index
 * model. Annotated nodes are grouped by role in first-seen order (the graph's node
 * order is deterministic, so the index is stable); diagrams reuse the same
 * by-category grouping the diagrams drawer uses. Enrichments are keyed by address
 * (the same map the render layer attaches per node).
 */
export function buildKnowledgeIndex(
  nodes: readonly GraphNode[],
  enrichments: ReadonlyMap<string, NodeEnrichment>,
  diagrams: DiagramSet,
): KnowledgeIndexModel {
  const roleOrder: string[] = [];
  const byRole = new Map<string, KnowledgeNodeEntry[]>();
  let annotatedCount = 0;

  for (const node of nodes) {
    const e = enrichments.get(node.address);
    if (!e) continue;
    annotatedCount++;
    const role = e.role.trim() || ROLE_FALLBACK;
    let bucket = byRole.get(role);
    if (!bucket) {
      bucket = [];
      byRole.set(role, bucket);
      roleOrder.push(role);
    }
    bucket.push({ address: node.address, name: node.name, kind: node.kind, summary: e.summary });
  }

  const roleGroups: KnowledgeRoleGroup[] = roleOrder.map((role) => ({
    role,
    entries: byRole.get(role) ?? [],
  }));

  const diagramGroups: KnowledgeDiagramGroup[] = [];
  for (const [category, ds] of diagramsByCategory(diagrams)) {
    diagramGroups.push({ category, diagrams: ds.map((d) => ({ id: d.id, title: d.title })) });
  }

  return {
    annotatedCount,
    totalNodes: nodes.length,
    diagramCount: diagrams.diagrams.length,
    roleGroups,
    diagramGroups,
  };
}

// A repo with no captured knowledge yet is the common first-run case; a blank panel
// reads as broken. This names exactly how knowledge appears — the connected agent
// calls annotate_node and save_diagram — which is the onboarding moment.
function emptyStateHtml(): string {
  return (
    `<div class="ki-empty">` +
    `<p class="ki-empty-title">No knowledge captured yet</p>` +
    `<p class="ki-empty-body">Connect your AI agent over MCP and ask it to explore this repo. ` +
    `As it reads the graph it calls <code>annotate_node</code> to describe nodes and ` +
    `<code>save_diagram</code> to map flows — they gather here as the repo's table of contents.</p>` +
    `</div>`
  );
}

function nodeEntryHtml(e: KnowledgeNodeEntry): string {
  return (
    `<button class="ki-item" type="button" data-addr="${esc(e.address)}" title="${esc(e.address)}">` +
    `<span class="ki-row"><span class="ki-name">${esc(e.name)}</span>` +
    `<span class="ki-kind k-${esc(e.kind)}">${esc(e.kind)}</span></span>` +
    `<span class="ki-sum">${esc(e.summary)}</span>` +
    `</button>`
  );
}

function roleGroupHtml(g: KnowledgeRoleGroup): string {
  return (
    `<section class="ki-group">` +
    `<h4 class="ki-head">${esc(g.role)}<span class="ki-n">${g.entries.length}</span></h4>` +
    `${g.entries.map(nodeEntryHtml).join("")}</section>`
  );
}

function diagramEntryHtml(d: KnowledgeDiagramEntry): string {
  return (
    `<button class="ki-dg" type="button" data-id="${esc(d.id)}">` +
    `<span class="ki-name">${esc(d.title)}</span></button>`
  );
}

function diagramGroupHtml(g: KnowledgeDiagramGroup): string {
  return (
    `<section class="ki-group ki-dgroup">` +
    `<h4 class="ki-head">${esc(g.category)}<span class="ki-n">${g.diagrams.length}</span></h4>` +
    `${g.diagrams.map(diagramEntryHtml).join("")}</section>`
  );
}

/**
 * The index body: an "Annotated nodes" section (role groups, a button per node
 * tagged with its address) and a "Diagrams" section (category groups, a button per
 * diagram tagged with its id). Every interpolated value is escaped. When nothing
 * has been captured at all, an onboarding empty state is returned instead.
 */
export function knowledgeIndexHtml(model: KnowledgeIndexModel): string {
  if (model.annotatedCount === 0 && model.diagramCount === 0) return emptyStateHtml();
  const parts: string[] = [];
  if (model.roleGroups.length > 0) {
    parts.push(`<div class="ki-section">Annotated nodes</div>`);
    parts.push(...model.roleGroups.map(roleGroupHtml));
  }
  if (model.diagramGroups.length > 0) {
    parts.push(`<div class="ki-section">Diagrams</div>`);
    parts.push(...model.diagramGroups.map(diagramGroupHtml));
  }
  return parts.join("");
}
