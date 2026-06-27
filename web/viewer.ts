// Standalone web viewer (Epic 6): loads a GraphSnapshot exported from the
// codegraph panel and renders it with Sigma — no editor, no server. It reuses
// the pure render/projection/card modules; only the orchestration (file load,
// local projection) is specific to the standalone context. Static by nature: a
// snapshot has no live delta, so there is no change feed here.

import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  buildRenderModel,
  findOrphanAddresses,
  type RenderModel,
} from "../src/adapters/surfaces/webview/render-model.js";
import { enrichmentSectionHtml, orphanNoteHtml } from "../src/adapters/surfaces/webview/card.js";
import { nodeHiddenAtRatio } from "../src/adapters/surfaces/webview/lod.js";
import { projectGraph, type ProjectionKind } from "../src/core/graph/projection.js";
import { parseGraphSnapshot, type GraphSnapshot } from "../src/core/graph/export.js";
import type { NodeKind } from "../src/core/graph/types.js";
import type { NodeEnrichment } from "../src/core/semantic/enrichment.js";

const container = document.getElementById("app") as HTMLElement;
const card = document.getElementById("card") as HTMLElement;
const metaEl = document.getElementById("meta") as HTMLElement;
const errEl = document.getElementById("err") as HTMLElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const orphanToggle = document.getElementById("orphan-toggle") as HTMLButtonElement;
const orphanCountEl = document.getElementById("orphan-count") as HTMLElement;

// Orphan overlay (FR-12): dim every non-orphan so dead-code candidates stand
// alone. Same recessive tones as the panel so the two surfaces read the same.
const ORPHAN_DIM_NODE = "#39414f";
const ORPHAN_DIM_EDGE = "#262c38";
let orphanMode = false;
let snapshot: GraphSnapshot | undefined;
let projection: ProjectionKind = "full";
let renderer: Sigma | undefined;
let graph: Graph | undefined;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
function shortName(addr: string): string {
  return addr.includes("#") ? (addr.split("#").pop() as string) : addr;
}

// Hover capability card (FR-11): node info, its annotation, and grouped edges.
function showCard(g: Graph, id: string): void {
  const a = g.getNodeAttributes(id) as {
    label: string;
    kind: string;
    color: string;
    file: string;
    line: number;
    enrichment?: NodeEnrichment;
    orphan?: boolean;
  };
  const out = new Map<string, string[]>();
  g.forEachOutEdge(id, (_e: string, attrs: { relation?: string }, _s: string, target: string) => {
    const rel = attrs.relation ?? "edge";
    const list = out.get(rel) ?? [];
    list.push(target);
    out.set(rel, list);
  });
  const callers: string[] = [];
  g.forEachInEdge(id, (_e: string, _attrs: unknown, source: string) => callers.push(source));

  let html = `<h3>${esc(a.label)}</h3><span class="kind" style="color:${esc(a.color)}">${esc(a.kind)}</span>`;
  html += enrichmentSectionHtml(a.enrichment);
  html += `<div class="loc">${esc(a.file)}:${a.line + 1}</div>`;
  for (const [rel, targets] of out) {
    html += `<div class="group"><b>${esc(rel)} (${targets.length})</b><ul>${targets
      .slice(0, 8)
      .map((t) => `<li>${esc(shortName(t))}</li>`)
      .join("")}</ul></div>`;
  }
  if (callers.length) {
    html += `<div class="group"><b>used by (${callers.length})</b><ul>${callers
      .slice(0, 8)
      .map((c) => `<li>${esc(shortName(c))}</li>`)
      .join("")}</ul></div>`;
  }
  html += orphanNoteHtml(a.orphan);
  card.innerHTML = html;
  card.classList.remove("hidden");
}

function render(model: RenderModel): void {
  renderer?.kill();
  renderer = undefined;
  graph = undefined;
  container.innerHTML = "";
  if (model.nodes.length === 0) {
    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:hsl(228 10% 44%);font:13px var(--mono,monospace)">No nodes in this projection.</div>';
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
  renderer.on("enterNode", ({ node }: { node: string }) => showCard(g, node));
  renderer.on("clickStage", () => card.classList.add("hidden"));
  syncOrphanToggle(model.orphanCount);

  // Compose the two view lenses (re-run cheaply on refresh()): semantic-zoom LOD
  // for large graphs (FR-5) and the orphan overlay (FR-12). Mirrors the panel.
  const camera = renderer.getCamera();
  const lod = g.order > 300;
  renderer.setSetting("nodeReducer", (node: string, data: { kind: NodeKind }) => {
    const res: { kind: NodeKind; hidden?: boolean; color?: string; label?: string; forceLabel?: boolean } =
      { ...data };
    if (lod && nodeHiddenAtRatio(data.kind, camera.ratio)) res.hidden = true;
    if (orphanMode) {
      if (g.getNodeAttribute(node, "orphan")) {
        res.hidden = false;
        res.forceLabel = true;
      } else {
        res.color = ORPHAN_DIM_NODE;
        res.label = "";
      }
    }
    return res;
  });
  renderer.setSetting("edgeReducer", (edge: string, data: object) => {
    const res: { hidden?: boolean; color?: string } = { ...data };
    if (lod) {
      const sk = g.getNodeAttribute(g.source(edge), "kind") as NodeKind;
      const tk = g.getNodeAttribute(g.target(edge), "kind") as NodeKind;
      if (nodeHiddenAtRatio(sk, camera.ratio) || nodeHiddenAtRatio(tk, camera.ratio)) res.hidden = true;
    }
    if (orphanMode) res.color = ORPHAN_DIM_EDGE;
    return res;
  });
  if (lod) camera.on("updated", () => renderer?.refresh());
}

// Keep the topbar toggle honest: show the count, disable when nothing to
// highlight, and drop out of orphan mode if this projection has no orphans.
function syncOrphanToggle(count: number): void {
  orphanCountEl.textContent = String(count);
  orphanToggle.disabled = count === 0;
  if (count === 0 && orphanMode) orphanMode = false;
  orphanToggle.classList.toggle("active", orphanMode);
  orphanToggle.setAttribute("aria-pressed", String(orphanMode));
}

// Re-project the loaded snapshot locally and repaint. Orphan status is computed
// from the FULL snapshot edge set so a projection never fakes an orphan (FR-12).
function rebuild(): void {
  if (!snapshot) return;
  const projected = projectGraph(snapshot.nodes, snapshot.edges, projection);
  const orphans = findOrphanAddresses(snapshot.nodes, snapshot.edges);
  const enrich = snapshot.enrichments
    ? new Map<string, NodeEnrichment>(Object.entries(snapshot.enrichments))
    : undefined;
  render(buildRenderModel(projected.nodes, projected.edges, undefined, undefined, undefined, enrich, orphans));
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

// Orphan overlay toggle (FR-12): flip the lens and re-run reducers — no relayout.
orphanToggle.addEventListener("click", () => {
  if (orphanToggle.disabled) return;
  orphanMode = !orphanMode;
  orphanToggle.classList.toggle("active", orphanMode);
  orphanToggle.setAttribute("aria-pressed", String(orphanMode));
  renderer?.refresh();
});

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
    for (const b of Array.from(document.querySelectorAll(".seg button"))) b.classList.remove("active");
    btn.classList.add("active");
    projection = (btn.dataset.projection as ProjectionKind) ?? "full";
    card.classList.add("hidden");
    rebuild();
  });
}
