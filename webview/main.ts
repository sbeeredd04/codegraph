import Graph from "graphology";
import Sigma from "sigma";
import type { RenderModel, RenderMessage } from "../src/adapters/surfaces/webview/render-model.js";

const vscode = acquireVsCodeApi();
const container = document.getElementById("app") as HTMLElement;
let renderer: Sigma | undefined;

function render(model: RenderModel): void {
  const graph = new Graph();
  for (const n of model.nodes) {
    graph.addNode(n.id, { label: n.label, x: n.x, y: n.y, size: n.size, color: n.color });
  }
  for (const e of model.edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
      graph.addEdgeWithKey(e.id, e.source, e.target, { color: "#30363d", size: 1 });
    }
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

// Tell the host we're mounted; it replies with the render model.
vscode.postMessage({ type: "ready" });
