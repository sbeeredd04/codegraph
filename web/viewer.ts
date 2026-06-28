// Standalone web viewer (Epic 6): loads a GraphSnapshot exported from the
// codegraph panel and renders it with Sigma — no editor, no server. It shares
// the pure render/projection/card modules and the browser graph-view glue with
// the in-editor panel; only the orchestration (file load, local projection) is
// specific here. Static by nature: a snapshot has no live delta, so there is no
// change feed and no entrance animation.

import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  buildRenderModel,
  findOrphanAddresses,
  type RenderModel,
} from "../src/adapters/surfaces/webview/render-model.js";
import { projectGraph, type ProjectionKind } from "../src/core/graph/projection.js";
import { parseGraphSnapshot, type GraphSnapshot } from "../src/core/graph/export.js";
import type { NodeEnrichment } from "../src/core/semantic/enrichment.js";
import { DIAGRAM_SET_VERSION } from "../src/core/diagrams/diagram.js";
import { buildDiagramPanel } from "../src/adapters/surfaces/webview/diagram-view.js";
import {
  showCard,
  installLensReducers,
  createOrphanToggle,
  createTraceController,
} from "../webview/graph-view.js";
import { createDiagramDrawer } from "../webview/diagram-drawer.js";
import { createCommandPalette } from "../webview/command-palette.js";

const container = document.getElementById("app") as HTMLElement;
const card = document.getElementById("card") as HTMLElement;
const metaEl = document.getElementById("meta") as HTMLElement;
const errEl = document.getElementById("err") as HTMLElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const orphanToggleEl = document.getElementById("orphan-toggle") as HTMLButtonElement;
const orphanCountEl = document.getElementById("orphan-count") as HTMLElement;

// The agent-authored diagrams ride along in the snapshot (Epic 7.5); the drawer is
// the same shared glue the panel uses, rendering Mermaid with strict security.
const diagrams = createDiagramDrawer({
  toggle: document.getElementById("diagrams-toggle") as HTMLButtonElement,
  toggleCount: document.getElementById("diagrams-count") as HTMLElement,
  drawer: document.getElementById("diagrams") as HTMLElement,
  drawerCount: document.getElementById("dg-count") as HTMLElement,
  close: document.getElementById("dg-close") as HTMLButtonElement,
  index: document.getElementById("dg-index") as HTMLElement,
  stageHead: document.getElementById("dg-stage-head") as HTMLElement,
  related: document.getElementById("dg-related") as HTMLElement,
  render: document.getElementById("dg-render") as HTMLElement,
}, { onSelectNode: (address) => focusNodeByAddress(address) });

let snapshot: GraphSnapshot | undefined;
let projection: ProjectionKind = "full";
let renderer: Sigma | undefined;
let graph: Graph | undefined;
const orphans = createOrphanToggle(orphanToggleEl, orphanCountEl, () => renderer?.refresh());

// Command palette (PM-backlog #2): ⌘K fuzzy jump to any node in the snapshot. It
// searches the FULL snapshot node set (not the current projection), and the jump
// reuses focusNodeByAddress, which falls back to the full view when the target is
// hidden by the active projection — so a search hit is always reachable.
const palette = createCommandPalette(
  {
    overlay: document.getElementById("palette") as HTMLElement,
    dialog: document.getElementById("cp-dialog") as HTMLElement,
    input: document.getElementById("cp-input") as HTMLInputElement,
    list: document.getElementById("cp-list") as HTMLElement,
    empty: document.getElementById("cp-empty") as HTMLElement,
    hint: document.getElementById("cp-hint") as HTMLElement,
  },
  {
    getNodes: () => snapshot?.nodes ?? [],
    onSelect: (address) => focusNodeByAddress(address),
    trigger: document.getElementById("search-toggle") as HTMLButtonElement,
  },
);

// Trace-path (PM-backlog #3, the human half of the find_path MCP tool): turn the
// toggle on, click a source node then a target node, and the shortest dependency
// path lights up while everything else recedes. The shared controller runs the
// pure findPathInEdges locally over the loaded snapshot — no host round-trip.
const trace = createTraceController({
  toggleEl: document.getElementById("trace-toggle") as HTMLButtonElement,
  statusEl: document.getElementById("trace-status") as HTMLElement,
  getRenderer: () => renderer,
  getNodes: () => snapshot?.nodes ?? [],
  getEdges: () => snapshot?.edges ?? [],
});

function render(model: RenderModel): void {
  renderer?.kill();
  renderer = undefined;
  graph = undefined;
  container.innerHTML = "";
  if (model.nodes.length === 0) {
    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:hsl(228 10% 44%);font:13px var(--mono,monospace)">No nodes in this projection.</div>';
    orphans.sync(model.orphanCount);
    return;
  }

  const g = new Graph({ type: "directed" });
  for (const n of model.nodes) {
    g.addNode(n.id, {
      label: n.label,
      x: n.x,
      y: n.y,
      size: n.size,
      color: n.color,
      kind: n.kind,
      file: n.file,
      line: n.line,
      enrichment: n.enrichment,
      orphan: n.orphan,
    });
  }
  for (const e of model.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
      g.addEdgeWithKey(e.id, e.source, e.target, { color: "#333a4d", size: 1, relation: e.type });
    }
  }
  if (g.order > 2) {
    forceAtlas2.assign(g, {
      iterations: Math.min(400, 100 + g.order),
      settings: forceAtlas2.inferSettings(g),
    });
  }
  graph = g;

  renderer = new Sigma(g, container, {
    defaultEdgeColor: "#333a4d",
    labelColor: { color: "#c9d3e3" },
    labelFont: "ui-monospace, Menlo, monospace",
    labelSize: 11,
    renderLabels: true,
  });
  renderer.on("enterNode", ({ node }: { node: string }) => showCard(g, node, card));
  renderer.on("clickNode", ({ node }: { node: string }) => trace.clickNode(node));
  renderer.on("clickStage", () => card.classList.add("hidden"));
  orphans.sync(model.orphanCount);
  installLensReducers({
    renderer,
    graph: g,
    lod: g.order > 300,
    isOrphanMode: orphans.isActive,
    pathOn: trace.highlight,
  });
}

// Re-project the loaded snapshot locally and repaint. Orphan status is computed
// from the FULL snapshot edge set so a projection never fakes an orphan (FR-12).
function rebuild(): void {
  if (!snapshot) return;
  const projected = projectGraph(snapshot.nodes, snapshot.edges, projection);
  const orphanSet = findOrphanAddresses(snapshot.nodes, snapshot.edges);
  const enrich = snapshot.enrichments
    ? new Map<string, NodeEnrichment>(Object.entries(snapshot.enrichments))
    : undefined;
  render(buildRenderModel(projected.nodes, projected.edges, undefined, undefined, undefined, enrich, orphanSet));
}

// Switch the projection and repaint (mirrors a toolbar click), reflecting the
// active segment. Used by the toolbar and by the diagram related-node jump.
function setProjection(kind: ProjectionKind): void {
  projection = kind;
  for (const b of Array.from(document.querySelectorAll(".seg button"))) b.classList.remove("active");
  document.querySelector(`.seg button[data-projection="${kind}"]`)?.classList.add("active");
  card.classList.add("hidden");
  // A different projection is a different node set — drop any traced path (its
  // nodes may not be present here); rebuild() repaints, so no refresh needed.
  trace.reset({ repaint: false });
  rebuild();
}

// Jump from a diagram's "related" chip to its graph node (Epic 7.5c). If the node
// is hidden by the current projection, fall back to the full view (which has every
// node) before focusing — but only when the address really is in this snapshot.
function focusNodeByAddress(address: string): void {
  if (!graph?.hasNode(address)) {
    if (!snapshot?.nodes.some((n) => n.address === address)) return; // unknown address: no-op
    setProjection("full"); // synchronous rebuild — the node is present after this
  }
  if (!renderer || !graph || !graph.hasNode(address)) return;
  const pos = renderer.getNodeDisplayData(address);
  if (pos) void renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.55 }, { duration: 420 });
  showCard(graph, address, card);
}

function loadText(text: string): void {
  const result = parseGraphSnapshot(text);
  if (!result.ok) {
    errEl.textContent = result.error;
    errEl.hidden = false;
    return;
  }
  errEl.hidden = true;
  snapshot = result.snapshot;
  projection = "full";
  for (const b of Array.from(document.querySelectorAll(".seg button"))) b.classList.remove("active");
  document.querySelector('.seg button[data-projection="full"]')?.classList.add("active");
  const when = snapshot.generatedAt ? ` · ${snapshot.generatedAt.slice(0, 10)}` : "";
  metaEl.textContent = `${snapshot.nodeCount} nodes · ${snapshot.edgeCount} edges${when}`;
  document.body.classList.add("loaded");
  card.classList.add("hidden");
  // A fresh snapshot resets trace mode entirely (old addresses don't apply).
  trace.disarm();
  // Diagrams are projection-independent, so reconcile the drawer once per load.
  diagrams.update(buildDiagramPanel({ version: DIAGRAM_SET_VERSION, diagrams: snapshot.diagrams ?? [] }));
  rebuild();
}

function pickFile(): void {
  fileInput.value = ""; // allow re-loading the same file
  fileInput.click();
}

function readFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => loadText(String(reader.result ?? ""));
  reader.onerror = () => {
    errEl.textContent = "Could not read that file.";
    errEl.hidden = false;
  };
  reader.readAsText(file);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) readFile(file);
});

for (const id of ["load", "empty-load"]) {
  document.getElementById(id)?.addEventListener("click", pickFile);
}

// Drag-and-drop a snapshot file anywhere on the page.
window.addEventListener("dragover", (e: DragEvent) => {
  e.preventDefault();
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", (e: DragEvent) => {
  if (e.relatedTarget === null) document.body.classList.remove("dragging");
});
window.addEventListener("drop", (e: DragEvent) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const file = e.dataTransfer?.files?.[0];
  if (file) readFile(file);
});

// Projection toolbar: switch the view of the loaded snapshot (FR-4), all local.
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".seg button"))) {
  btn.addEventListener("click", () => {
    setProjection((btn.dataset.projection as ProjectionKind) ?? "full");
  });
}

// Esc clears an in-progress trace — but only when the command palette isn't open
// (it owns Esc while focused), and only when there's a trace to clear.
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && !palette.isOpen() && trace.isTracing()) {
    trace.reset();
  }
});
