import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { RenderModel, RenderMessage } from "../src/adapters/surfaces/webview/render-model.js";
import { nodeHiddenAtRatio } from "../src/adapters/surfaces/webview/lod.js";
import type { NodeKind } from "../src/core/graph/types.js";

const vscode = acquireVsCodeApi();
const container = document.getElementById("app") as HTMLElement;
const card = document.getElementById("card") as HTMLElement;
let renderer: Sigma | undefined;

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

  let html = `<h3>${esc(a.label)}</h3><span class="kind" style="background:${a.color}">${esc(a.kind)}</span>`;
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
  card.innerHTML = html;
  card.classList.remove("hidden");
}

function render(model: RenderModel): void {
  renderer?.kill();
  renderer = undefined;
  if (model.nodes.length === 0) {
    container.innerHTML =
      '<div style="color:#6e7681;padding:20px;font:13px ui-monospace,monospace">No nodes in this projection yet.</div>';
    return;
  }
  container.innerHTML = "";

  const graph = new Graph({ type: "directed" });
  for (const n of model.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      x: n.x,
      y: n.y,
      size: n.size,
      color: n.color,
      kind: n.kind,
      file: n.file,
      line: n.line,
    });
  }
  for (const e of model.edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
      graph.addEdgeWithKey(e.id, e.source, e.target, { color: "#30363d", size: 1, relation: e.type });
    }
  }
  // Force-directed layout for legibility (circular seed -> real positions).
  if (graph.order > 2) {
    forceAtlas2.assign(graph, {
      iterations: Math.min(400, 100 + graph.order),
      settings: forceAtlas2.inferSettings(graph),
    });
  }

  renderer?.kill();
  renderer = new Sigma(graph, container, {
    defaultEdgeColor: "#30363d",
    labelColor: { color: "#c9d1d9" },
    labelFont: "ui-monospace, Menlo, monospace",
    labelSize: 11,
    renderLabels: true,
  });

  renderer.on("enterNode", ({ node }: { node: string }) => showCard(graph, node));
  renderer.on("clickStage", () => card.classList.add("hidden"));

  // Semantic-zoom LOD (FR-5): large graphs hide detail when zoomed out.
  if (graph.order > 300) {
    const camera = renderer.getCamera();
    renderer.setSetting("nodeReducer", (_node: string, data: { kind: NodeKind }) => ({
      ...data,
      hidden: nodeHiddenAtRatio(data.kind, camera.ratio),
    }));
    renderer.setSetting("edgeReducer", (edge: string, data: object) => {
      const sk = graph.getNodeAttribute(graph.source(edge), "kind") as NodeKind;
      const tk = graph.getNodeAttribute(graph.target(edge), "kind") as NodeKind;
      return { ...data, hidden: nodeHiddenAtRatio(sk, camera.ratio) || nodeHiddenAtRatio(tk, camera.ratio) };
    });
    camera.on("updated", () => renderer?.refresh());
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as RenderMessage | undefined;
  if (msg?.type === "render") render(msg.payload);
});

// Projection toolbar: switch the view of the one model (FR-4).
for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))) {
  btn.addEventListener("click", () => {
    for (const b of Array.from(document.querySelectorAll(".toolbar button"))) b.classList.remove("active");
    btn.classList.add("active");
    vscode.postMessage({ type: "setProjection", kind: btn.dataset.projection });
  });
}

// Tell the host we're mounted; it replies with the render model.
vscode.postMessage({ type: "ready" });
