import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { RenderModel, RenderMessage } from "../src/adapters/surfaces/webview/render-model.js";

const vscode = acquireVsCodeApi();
const container = document.getElementById("app") as HTMLElement;
let renderer: Sigma | undefined;

function render(model: RenderModel): void {
  renderer?.kill();
  renderer = undefined;
  if (model.nodes.length === 0) {
    container.innerHTML =
      '<div style="color:#6e7681;padding:20px;font:13px ui-monospace,monospace">No nodes in this projection yet.</div>';
    return;
  }
  container.innerHTML = "";

  const graph = new Graph();
  for (const n of model.nodes) {
    graph.addNode(n.id, { label: n.label, x: n.x, y: n.y, size: n.size, color: n.color });
  }
  for (const e of model.edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
      graph.addEdgeWithKey(e.id, e.source, e.target, { color: "#30363d", size: 1 });
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
    renderLabels: graph.order <= 200,
  });
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
