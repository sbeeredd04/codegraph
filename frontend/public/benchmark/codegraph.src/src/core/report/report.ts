// Architecture report (PM-backlog #1, the "knowledge bridge" deliverable): fold a
// GraphSnapshot's structure, the agent's annotations, and the agent's Mermaid
// diagrams into ONE shareable Markdown document. The payoff is leverage with no
// new rendering infra — GitHub and the VS Code preview render ```mermaid fences
// natively, so the agent's diagrams travel as a portable doc a teammate can read
// without ever opening codegraph.
//
// Pure (AD-1): snapshot in, string out. No clock, no I/O — the adapter supplies
// the timestamp inside the snapshot. The snapshot's diagrams and enrichments are
// agent-written, so this module formats DEFENSIVELY: table pipes are escaped,
// single-line fields collapse their newlines, and the Mermaid fence grows past
// any backtick run in the source so untrusted content can never break the layout.

import type { GraphSnapshot } from "../graph/export.js";
import type { GraphEdge, NodeAddress, NodeKind } from "../graph/types.js";
import type { Diagram } from "../diagrams/diagram.js";
import { DEPENDENCY_EDGES, transitiveClosure } from "../graph/reachability.js";

export interface ReportOptions {
  /** Cap the "most depended-upon" table; 0 (or fewer) omits the section. Default 15. */
  readonly topNodes?: number;
}

/** Render a snapshot as a self-contained Markdown architecture report. */
export function buildMarkdownReport(snapshot: GraphSnapshot, opts: ReportOptions = {}): string {
  const top = opts.topNodes ?? 15;
  const sections = [
    header(snapshot),
    overview(snapshot),
    keyNodes(snapshot, top),
    diagramsSection(snapshot.diagrams),
    annotationsSection(snapshot),
  ].filter((s) => s.length > 0);
  return sections.join("\n\n") + "\n";
}

const KIND_ORDER: readonly NodeKind[] = ["module", "class", "function", "method", "workflow"];

function header(snapshot: GraphSnapshot): string {
  const base = snapshot.root ? baseName(snapshot.root) : undefined;
  const title = base ? `${base} — Architecture Report` : "Architecture Report";
  const when = snapshot.generatedAt ? snapshot.generatedAt.slice(0, 10) : undefined;
  const meta = [`${snapshot.nodeCount} nodes`, `${snapshot.edgeCount} edges`, ...(when ? [when] : [])];
  return `# ${title}\n\n> ${meta.join(" · ")}`;
}

function overview(snapshot: GraphSnapshot): string {
  const kindBits = countByKind(snapshot.nodes)
    .map(([kind, n]) => `${n} ${pluralKind(kind, n)}`)
    .join(", ");
  return [
    "## Overview",
    "",
    `- **Nodes:** ${snapshot.nodeCount}${kindBits ? ` — ${kindBits}` : ""}`,
    `- **Edges:** ${snapshot.edgeCount}`,
    `- **Orphans:** ${orphanCount(snapshot)} (no dependency edges)`,
  ].join("\n");
}

function keyNodes(snapshot: GraphSnapshot, top: number): string {
  if (top <= 0 || snapshot.nodes.length === 0) return "";
  const rev = reverseDependencyAdjacency(snapshot.edges);
  const ranked = snapshot.nodes
    .map((n) => ({ n, deps: transitiveClosure(n.address, rev).length }))
    .filter((r) => r.deps > 0)
    .sort((a, b) => b.deps - a.deps || a.n.name.localeCompare(b.n.name))
    .slice(0, top);
  if (ranked.length === 0) return "";
  const rows = ranked
    .map((r) => `| \`${escTableCell(r.n.name)}\` | ${r.n.kind} | ${r.deps} |`)
    .join("\n");
  return [
    "## Most depended-upon",
    "",
    "Nodes the most other code transitively reaches — the load-bearing pieces.",
    "",
    "| Node | Kind | Dependents |",
    "| --- | --- | ---: |",
    rows,
  ].join("\n");
}

function diagramsSection(diagrams: readonly Diagram[] | undefined): string {
  if (!diagrams || diagrams.length === 0) return "";
  const parts = ["## Diagrams"];
  for (const [category, list] of groupByCategory(diagrams)) {
    parts.push("", `### ${titleCase(category)}`);
    for (const d of list) {
      parts.push("", `#### ${oneLine(d.title)}`);
      if (d.description) parts.push("", oneLine(d.description));
      parts.push("", mermaidFence(d.mermaid));
      if (d.related && d.related.length > 0) {
        parts.push("", `_Related:_ ${d.related.map((a) => `\`${oneLine(a)}\``).join(", ")}`);
      }
    }
  }
  return parts.join("\n");
}

function annotationsSection(snapshot: GraphSnapshot): string {
  const enrichments = snapshot.enrichments;
  if (!enrichments) return "";
  const entries = Object.entries(enrichments);
  if (entries.length === 0) return "";
  // Order by where each node appears in the graph (stable, reading-order) rather
  // than by the enrichment record's key order.
  const order = new Map(snapshot.nodes.map((n, i) => [n.address, i] as const));
  entries.sort(
    (a, b) =>
      (order.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (order.get(b[0]) ?? Number.MAX_SAFE_INTEGER) ||
      a[0].localeCompare(b[0]),
  );
  const parts = ["## Annotations"];
  for (const [address, e] of entries) {
    parts.push("", `### \`${oneLine(address)}\``, "");
    if (e.role) parts.push(`- **Role:** ${oneLine(e.role)}`);
    if (e.summary) parts.push(`- **Summary:** ${oneLine(e.summary)}`);
    if (e.intent) parts.push(`- **Intent:** ${oneLine(e.intent)}`);
  }
  return parts.join("\n");
}

// --- small pure helpers -----------------------------------------------------

/** Counts per kind, in declaration order, dropping zero-count kinds. */
function countByKind(nodes: GraphSnapshot["nodes"]): Array<[NodeKind, number]> {
  const counts = new Map<NodeKind, number>();
  for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  return KIND_ORDER.flatMap((k) => {
    const c = counts.get(k);
    return c ? [[k, c] as [NodeKind, number]] : [];
  });
}

function pluralKind(kind: NodeKind, n: number): string {
  if (n === 1) return kind;
  return kind === "class" ? "classes" : `${kind}s`;
}

/** Nodes touched by no dependency edge (neither caller nor callee). */
function orphanCount(snapshot: GraphSnapshot): number {
  const touched = new Set<NodeAddress>();
  for (const e of snapshot.edges) {
    if (!DEPENDENCY_EDGES.has(e.type)) continue;
    touched.add(e.from);
    touched.add(e.to);
  }
  return snapshot.nodes.reduce((acc, n) => acc + (touched.has(n.address) ? 0 : 1), 0);
}

/** to -> [from...] over dependency edges only — what each node's dependents are. */
function reverseDependencyAdjacency(edges: readonly GraphEdge[]): Map<NodeAddress, NodeAddress[]> {
  const rev = new Map<NodeAddress, NodeAddress[]>();
  for (const e of edges) {
    if (!DEPENDENCY_EDGES.has(e.type)) continue;
    const list = rev.get(e.to);
    if (list) list.push(e.from);
    else rev.set(e.to, [e.from]);
  }
  return rev;
}

/** Group diagrams by category, preserving first-seen order (mirrors the board). */
function groupByCategory(diagrams: readonly Diagram[]): Map<string, Diagram[]> {
  const groups = new Map<string, Diagram[]>();
  for (const d of diagrams) {
    const list = groups.get(d.category);
    if (list) list.push(d);
    else groups.set(d.category, [d]);
  }
  return groups;
}

/** A fenced ```mermaid block whose fence is always longer than any backtick run
 * inside the (untrusted) source, so the diagram can never escape its block. */
function mermaidFence(source: string): string {
  const body = source.replace(/\r\n/g, "\n");
  let longest = 0;
  let run = 0;
  for (const ch of body) {
    if (ch === "`") longest = Math.max(longest, ++run);
    else run = 0;
  }
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}mermaid\n${body}\n${ticks}`;
}

/** Collapse all whitespace runs (incl. newlines) to single spaces — keeps an
 * agent-written field on one Markdown line so it can't inject blocks. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** One-line a value and escape the pipe so it survives inside a table cell. */
function escTableCell(s: string): string {
  return oneLine(s).replace(/\|/g, "\\|");
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Last path segment of a repo root, tolerating both separators and trailing slashes. */
function baseName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : root;
}
