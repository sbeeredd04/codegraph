import * as vscode from "vscode";
import type { GraphNode, GraphEdge } from "../../../core/graph/types.js";
import { projectGraph, type ProjectionKind } from "../../../core/graph/projection.js";
import { buildRenderModel, type RenderMessage } from "./render-model.js";

// Outbound surface (AD-2): a webview panel beside the editor. Holds the source
// graph and re-projects on toggle (FR-4); only renders, never mutates code (FR-9).
export class GraphPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static nodes: readonly GraphNode[] = [];
  private static edges: readonly GraphEdge[] = [];
  private static projection: ProjectionKind = "full";

  static show(context: vscode.ExtensionContext, nodes: readonly GraphNode[], edges: readonly GraphEdge[]): void {
    this.nodes = nodes;
    this.edges = edges;
    this.projection = "full";
    const column = vscode.ViewColumn.Beside;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("codegraph", "codegraph", column, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      });
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((msg: { type?: string; kind?: ProjectionKind }) => {
        if (msg?.type === "ready") {
          this.send();
        } else if (msg?.type === "setProjection" && msg.kind) {
          this.projection = msg.kind;
          this.send();
        }
      });
    } else {
      this.panel.reveal(column);
    }

    this.panel.webview.html = this.html(context, this.panel.webview);
  }

  private static send(): void {
    if (!this.panel) return;
    const projected = projectGraph(this.nodes, this.edges, this.projection);
    const message: RenderMessage = {
      type: "render",
      version: 1,
      payload: buildRenderModel(projected.nodes, projected.edges),
    };
    void this.panel.webview.postMessage(message);
  }

  private static html(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "webview.js"),
    );
    const csp = [
      `default-src 'none'`,
      `script-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    html, body { height: 100%; margin: 0; background: #0d1117; color: #c9d1d9;
      font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    #app { position: absolute; inset: 36px 0 0 0; }
    .toolbar { position: absolute; top: 0; left: 0; right: 0; height: 36px; z-index: 3;
      display: flex; align-items: center; gap: 6px; padding: 0 10px;
      background: #161b22; border-bottom: 1px solid #21262d; }
    .toolbar button { background: #21262d; color: #8b949e; border: 1px solid #30363d;
      border-radius: 5px; padding: 3px 10px; font: inherit; cursor: pointer; }
    .toolbar button:hover { color: #c9d1d9; }
    .toolbar button.active { background: #1f6feb33; color: #58a6ff; border-color: #1f6feb; }
    .legend { margin-left: auto; color: #6e7681; }
    .legend span { margin-left: 10px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
    .card { position: absolute; top: 46px; right: 12px; width: 290px; z-index: 4;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 14px;
      box-shadow: 0 8px 24px #00000077; max-height: calc(100% - 60px); overflow: auto; }
    .card.hidden { display: none; }
    .card h3 { margin: 0; font-size: 13px; color: #e6edf3; word-break: break-all; }
    .card .kind { display: inline-block; margin-top: 4px; padding: 1px 7px; border-radius: 4px;
      font-size: 10px; color: #0d1117; font-weight: 600; }
    .card .loc { color: #6e7681; margin: 6px 0 8px; word-break: break-all; }
    .card .group { margin-top: 8px; }
    .card .group b { color: #8b949e; }
    .card ul { margin: 3px 0 0; padding-left: 16px; }
    .card li { color: #9ca3af; word-break: break-all; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button data-projection="full" class="active">Full</button>
    <button data-projection="dependency">Dependency</button>
    <button data-projection="structure">Structure</button>
    <button data-projection="call">Call</button>
    <span class="legend">
      <span><i class="dot" style="background:#7aa2f7"></i>module</span>
      <span><i class="dot" style="background:#bb9af7"></i>class</span>
      <span><i class="dot" style="background:#9ece6a"></i>function</span>
      <span><i class="dot" style="background:#7dcfff"></i>method</span>
    </span>
  </div>
  <div id="app"></div>
  <div id="card" class="card hidden"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
