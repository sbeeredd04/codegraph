import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { RenderModel, RenderMessage } from "../src/adapters/surfaces/webview/render-model.js";
import type { RankedChange } from "../src/core/graph/change-feed.js";
import { reconcilePositions, type XY } from "../src/adapters/surfaces/webview/layout.js";
import { esc } from "../src/adapters/surfaces/webview/card.js";
import {
  showCard,
  installLensReducers,
  createOrphanToggle,
  animateNodeEntrance,
} from "./graph-view.js";
import { createDiagramDrawer } from "./diagram-drawer.js";

const vscode = acquireVsCodeApi();
const container = document.getElementById("app") as HTMLElement;
const card = document.getElementById("card") as HTMLElement;
const badge = document.getElementById("badge") as HTMLElement;
const feedEl = document.getElementById("feed") as HTMLElement;
const orphanToggleEl = document.getElementById("orphan-toggle") as HTMLButtonElement;
const orphanCountEl = document.getElementById("orphan-count") as HTMLElement;

// Agent-authored Mermaid diagrams drawer (Epic 7): wired once, fed the diagram
// panel model on every host repaint.
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
}, { onSelectNode: (address) => gotoRelatedNode(address) });
const CHANGE_COLORS: Record<RankedChange["change"], string> = {
  added: "#3fb950",
  changed: "#e3b341",
  moved: "#a371f7",
  removed: "#f85149",
};
const orphans = createOrphanToggle(orphanToggleEl, orphanCountEl, () => renderer?.refresh());
let renderer: Sigma | undefined;
let graph: Graph | undefined;
// Force a fresh force-directed layout on the next paint. True for the first paint
// and whenever the user switches projection (the node set changes wholesale); a
// host-driven live delta leaves it false so surviving nodes keep their place.
let relayout = true;
// Canceller for the in-flight new-node entrance animation. Invoked before any
// repaint so a queued frame never refresh()es a renderer we are about to kill.
let cancelEnter: (() => void) | undefined;

// Pan/zoom the camera to a node and surface its capability card (feed -> graph).
function focusNode(id: string): void {
  if (!renderer || !graph || !graph.hasNode(id)) return;
  const pos = renderer.getNodeDisplayData(id);
  if (pos) void renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.55 }, { duration: 420 });
  showCard(graph, id, card);
}

// A node address awaiting focus after a projection switch (diagram -> graph, Epic
// 7.5c): the related node may be hidden by the current projection, so we switch to
// the full view and focus it once the new model paints.
let pendingFocus: string | undefined;

// Jump from a diagram's "related" chip to its graph node. If the node is in the
// current projection, focus it now; otherwise switch to the full view (which has
// every node) and focus once it repaints.
function gotoRelatedNode(address: string): void {
  if (graph?.hasNode(address)) {
    focusNode(address);
    return;
  }
  pendingFocus = address;
  setProjection("full");
}

// Switch the projection from code (mirrors a toolbar click): reflect the active
// segment and ask the host to re-render. No-op if already on that projection's view.
function setProjection(kind: string): void {
  for (const b of Array.from(document.querySelectorAll(".seg button"))) {
    b.classList.toggle("active", (b as HTMLElement).dataset.projection === kind);
  }
  relayout = true; // a new projection is a new node set — lay it out fresh
  vscode.postMessage({ type: "setProjection", kind });
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
  cancelEnter?.(); // stop any entrance animation before we tear the old graph down
  cancelEnter = undefined;
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
    orphans.sync(model.orphanCount);
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

  renderer = new Sigma(g, container, {
    defaultEdgeColor: "#333a4d",
    labelColor: { color: "#c9d3e3" },
    labelFont: "ui-monospace, Menlo, monospace",
    labelSize: 11,
    renderLabels: true,
  });

  renderer.on("enterNode", ({ node }: { node: string }) => showCard(g, node, card));
  renderer.on("clickStage", () => card.classList.add("hidden"));

  renderFeed(model.feed);
  orphans.sync(model.orphanCount);
  installLensReducers({ renderer, graph: g, lod: g.order > 300, isOrphanMode: orphans.isActive });

  // Motion polish: on a live delta (not a fresh layout), pop the newly-added
  // nodes in so the change is felt rather than silently appearing.
  if (!fresh) {
    const newIds = model.nodes.filter((n) => !prev.has(n.id)).map((n) => n.id);
    cancelEnter = animateNodeEntrance(renderer, g, newIds);
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as RenderMessage | undefined;
  if (msg?.type === "render") {
    render(msg.payload);
    if (msg.diagrams) diagrams.update(msg.diagrams);
    // A related-node click switched projection to reach a hidden node — focus it
    // now that the full view has painted, then clear (one-shot).
    if (pendingFocus) {
      focusNode(pendingFocus);
      pendingFocus = undefined;
    }
  }
});

// Projection toolbar: switch the view of the one model (FR-4).
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".seg button"))) {
  btn.addEventListener("click", () => setProjection(btn.dataset.projection ?? "full"));
}

// Tell the host we're mounted; it replies with the render model.
vscode.postMessage({ type: "ready" });
