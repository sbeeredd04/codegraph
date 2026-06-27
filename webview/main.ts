import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { RenderModel, RenderMessage } from "../src/adapters/surfaces/webview/render-model.js";
import type { RankedChange } from "../src/core/graph/change-feed.js";
import { nodeHiddenAtRatio } from "../src/adapters/surfaces/webview/lod.js";
import { reconcilePositions, type XY } from "../src/adapters/surfaces/webview/layout.js";
import { enrichmentSectionHtml, orphanNoteHtml } from "../src/adapters/surfaces/webview/card.js";
import type { NodeKind } from "../src/core/graph/types.js";
import type { NodeEnrichment } from "../src/core/semantic/enrichment.js";

const vscode = acquireVsCodeApi();
const container = document.getElementById("app") as HTMLElement;
const card = document.getElementById("card") as HTMLElement;
const badge = document.getElementById("badge") as HTMLElement;
const feedEl = document.getElementById("feed") as HTMLElement;
const orphanToggle = document.getElementById("orphan-toggle") as HTMLButtonElement;
const orphanCountEl = document.getElementById("orphan-count") as HTMLElement;
const CHANGE_COLORS: Record<RankedChange["change"], string> = {
  added: "#3fb950",
  changed: "#e3b341",
  moved: "#a371f7",
  removed: "#f85149",
};
// Orphan overlay (FR-12): when on, the nodeReducer dims every non-orphan so the
// dead-code candidates stand alone. Recessive — still visible, just quiet.
const ORPHAN_DIM_NODE = "#39414f";
const ORPHAN_DIM_EDGE = "#262c38";
let orphanMode = false;
let renderer: Sigma | undefined;
let graph: Graph | undefined;
// Force a fresh force-directed layout on the next paint. True for the first paint
// and whenever the user switches projection (the node set changes wholesale); a
// host-driven live delta leaves it false so surviving nodes keep their place.
let relayout = true;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
function shortName(addr: string): string {
  return addr.includes("#") ? (addr.split("#").pop() as string) : addr;
}

// Hover capability card (FR-11): node info + its edges grouped by relation.
function showCard(graph: Graph, id: string): void {
  const a = graph.getNodeAttributes(id) as {
    label: string;
    kind: string;
    color: string;
    file: string;
    line: number;
    enrichment?: NodeEnrichment;
    orphan?: boolean;
  };
  const out = new Map<string, string[]>();
  graph.forEachOutEdge(id, (_e: string, attrs: { relation?: string }, _s: string, target: string) => {
    const rel = attrs.relation ?? "edge";
    const list = out.get(rel) ?? [];
    list.push(target);
    out.set(rel, list);
  });
  const callers: string[] = [];
  graph.forEachInEdge(id, (_e: string, _attrs: unknown, source: string) => callers.push(source));

  let html = `<h3>${esc(a.label)}</h3><span class="kind" style="color:${esc(a.color)}">${esc(a.kind)}</span>`;
  // Agent annotation leads the card — the "what is this" answer above the edges.
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
  // No callers? Flag it as a dead-code candidate (FR-12). orphan and callers are
  // mutually exclusive — an orphan is precisely a node with no inbound references.
  html += orphanNoteHtml(a.orphan);
  card.innerHTML = html;
  card.classList.remove("hidden");
}

// Pan/zoom the camera to a node and surface its capability card (feed -> graph).
function focusNode(id: string): void {
  if (!renderer || !graph || !graph.hasNode(id)) return;
  const pos = renderer.getNodeDisplayData(id);
  if (pos) void renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.55 }, { duration: 420 });
  showCard(graph, id);
}

// Ranked change feed (FR-7 triage): highest blast-radius change at the top.
function renderFeed(feed: readonly RankedChange[] | undefined): void {
  if (!feed || feed.length === 0) {
    feedEl.classList.add("hidden");
    feedEl.innerHTML = "";
    return;
  }
  const maxBlast = feed.reduce((m, c) => Math.max(m, c.blastRadius), 0);
  const rows = feed
    .map((c) => {
      const hot = c.blastRadius > 0 && c.blastRadius >= Math.max(3, maxBlast * 0.5) ? " hot" : "";
      const aria = `${esc(c.name)}, ${c.change}, ${c.blastRadius} dependents`;
      return (
        `<button class="row" data-id="${esc(c.address)}" aria-label="${aria}" ` +
        `title="${c.blastRadius} node(s) depend on this — focus in graph">` +
        `<i class="chip" style="color:${CHANGE_COLORS[c.change]}"></i>` +
        `<span class="name">${esc(c.name)} <em>${esc(c.change)}</em></span>` +
        `<span class="blast${hot}">↯ ${c.blastRadius}</span>` +
        `</button>`
      );
    })
    .join("");
  feedEl.innerHTML =
    `<header><h3>Changes</h3><span class="count">${feed.length}</span>` +
    `<span class="hint">by blast radius</span></header><ol>${rows}</ol>`;
  feedEl.classList.remove("hidden");
  for (const row of Array.from(feedEl.querySelectorAll<HTMLButtonElement>(".row"))) {
    row.addEventListener("click", () => {
      for (const r of Array.from(feedEl.querySelectorAll(".row"))) r.classList.remove("active");
      row.classList.add("active");
      focusNode(row.dataset.id as string);
    });
  }
}

function render(model: RenderModel): void {
  // Snapshot where every node currently sits BEFORE we tear the graph down, so a
  // repaint can preserve those positions instead of jumping (stable live layout).
  const prev = new Map<string, XY>();
  if (graph) graph.forEachNode((id: string, a: Record<string, number>) => prev.set(id, { x: a.x, y: a.y }));
  const fresh = relayout || prev.size === 0;

  const d = model.delta;
  if (d && (d.added || d.removed || d.changed || d.moved)) {
    badge.innerHTML =
      `<b style="color:#3fb950">+${d.added}</b>` +
      `<b style="color:#e3b341">~${d.changed}</b>` +
      `<b style="color:#a371f7">↦${d.moved}</b>` +
      `<b style="color:#f85149">−${d.removed}</b>`;
    badge.classList.add("show");
  } else {
    badge.classList.remove("show");
  }

  renderer?.kill();
  renderer = undefined;
  graph = undefined;
  if (model.nodes.length === 0) {
    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:hsl(228 10% 44%);font:13px var(--mono,monospace)">No nodes in this projection yet.</div>';
    renderFeed(model.feed);
    return;
  }
  container.innerHTML = "";

  // Live repaint: keep surviving nodes put, seed new ones near their neighbours.
  const positions = fresh ? undefined : reconcilePositions(model.nodes, model.edges, prev);
  const g = new Graph({ type: "directed" });
  for (const n of model.nodes) {
    const p = positions?.get(n.id);
    g.addNode(n.id, {
      label: n.label,
      x: p ? p.x : n.x,
      y: p ? p.y : n.y,
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
  // Force-directed layout only on a fresh paint (circular seed -> real positions);
  // a live delta reuses the reconciled positions so the graph never jumps.
  if (fresh && g.order > 2) {
    forceAtlas2.assign(g, {
      iterations: Math.min(400, 100 + g.order),
      settings: forceAtlas2.inferSettings(g),
    });
  }
  graph = g;
  relayout = false;

  renderer?.kill();
  renderer = new Sigma(g, container, {
    defaultEdgeColor: "#333a4d",
    labelColor: { color: "#c9d3e3" },
    labelFont: "ui-monospace, Menlo, monospace",
    labelSize: 11,
    renderLabels: true,
  });

  renderer.on("enterNode", ({ node }: { node: string }) => showCard(g, node));
  renderer.on("clickStage", () => card.classList.add("hidden"));

  renderFeed(model.feed);
  syncOrphanToggle(model.orphanCount);

  // Two view lenses share the reducers (re-run cheaply on refresh()):
  //  - Semantic-zoom LOD (FR-5): large graphs hide detail when zoomed out.
  //  - Orphan overlay (FR-12): dim every non-orphan so dead-code candidates pop.
  const camera = renderer.getCamera();
  const lod = g.order > 300;
  renderer.setSetting("nodeReducer", (node: string, data: { kind: NodeKind }) => {
    const res: { kind: NodeKind; hidden?: boolean; color?: string; label?: string; forceLabel?: boolean } =
      { ...data };
    if (lod && nodeHiddenAtRatio(data.kind, camera.ratio)) res.hidden = true;
    if (orphanMode) {
      if (g.getNodeAttribute(node, "orphan")) {
        res.hidden = false; // never lose an orphan you're hunting
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
    if (orphanMode) res.color = ORPHAN_DIM_EDGE; // recede the wiring so nodes lead
    return res;
  });
  if (lod) camera.on("updated", () => renderer?.refresh());
}

// Keep the topbar toggle honest about the current view: show the count, disable
// it when there's nothing to highlight, and drop out of orphan mode if the
// current projection has no orphans to show.
function syncOrphanToggle(count: number): void {
  orphanCountEl.textContent = String(count);
  orphanToggle.disabled = count === 0;
  if (count === 0 && orphanMode) orphanMode = false;
  orphanToggle.classList.toggle("active", orphanMode);
  orphanToggle.setAttribute("aria-pressed", String(orphanMode));
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as RenderMessage | undefined;
  if (msg?.type === "render") render(msg.payload);
});

// Projection toolbar: switch the view of the one model (FR-4).
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".seg button"))) {
  btn.addEventListener("click", () => {
    for (const b of Array.from(document.querySelectorAll(".seg button"))) b.classList.remove("active");
    btn.classList.add("active");
    relayout = true; // a new projection is a new node set — lay it out fresh
    vscode.postMessage({ type: "setProjection", kind: btn.dataset.projection });
  });
}

// Orphan overlay toggle (FR-12): flip the lens and re-run reducers — no relayout,
// so the camera and node positions stay put while the dimming animates in.
orphanToggle.addEventListener("click", () => {
  if (orphanToggle.disabled) return;
  orphanMode = !orphanMode;
  orphanToggle.classList.toggle("active", orphanMode);
  orphanToggle.setAttribute("aria-pressed", String(orphanMode));
  renderer?.refresh();
});

// Tell the host we're mounted; it replies with the render model.
vscode.postMessage({ type: "ready" });
