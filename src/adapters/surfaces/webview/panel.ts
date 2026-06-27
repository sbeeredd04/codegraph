import * as vscode from "vscode";
import type { GraphNode, GraphEdge, GraphDelta } from "../../../core/graph/types.js";
import type { RankedChange } from "../../../core/graph/change-feed.js";
import { projectGraph, type ProjectionKind } from "../../../core/graph/projection.js";
import { buildRenderModel, changesFromDelta, deltaCounts, type RenderMessage } from "./render-model.js";

// Outbound surface (AD-2): a webview panel beside the editor. Holds the source
// graph and re-projects on toggle (FR-4); only renders, never mutates code (FR-9).
export class GraphPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static nodes: readonly GraphNode[] = [];
  private static edges: readonly GraphEdge[] = [];
  private static projection: ProjectionKind = "full";
  private static delta: GraphDelta | undefined;
  private static feed: readonly RankedChange[] | undefined;

  static show(
    context: vscode.ExtensionContext,
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    delta?: GraphDelta,
    feed?: readonly RankedChange[],
  ): void {
    this.nodes = nodes;
    this.edges = edges;
    this.delta = delta;
    this.feed = feed;
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
    const changes = this.delta ? changesFromDelta(this.delta) : undefined;
    const counts = this.delta ? deltaCounts(this.delta) : undefined;
    const message: RenderMessage = {
      type: "render",
      version: 1,
      payload: buildRenderModel(projected.nodes, projected.edges, changes, counts, this.feed),
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
    :root {
      --bg: hsl(228 16% 7%); --surface: hsl(228 15% 9.5%); --surface-2: hsl(228 14% 12%);
      --surface-3: hsl(228 13% 16%); --border: hsl(228 12% 19%); --border-2: hsl(228 12% 27%);
      --text: hsl(228 22% 93%); --text-2: hsl(228 12% 62%); --text-3: hsl(228 10% 44%);
      --accent: hsl(250 92% 71%);
      --k-module: #6aa3ff; --k-class: #b08cff; --k-function: #5fd39a;
      --k-method: #5cc8e6; --k-workflow: #f1b45a;
      --sh-1: 0 1px 2px hsl(228 40% 2% / .5);
      --sh-2: 0 12px 32px hsl(228 45% 2% / .55), 0 2px 8px hsl(228 40% 2% / .4);
      --sans: ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif;
      --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; background: var(--bg); color: var(--text);
      font: 13px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
    #app { position: absolute; inset: 48px 0 0 0; }

    .topbar { position: absolute; top: 0; left: 0; right: 0; height: 48px; z-index: 30;
      display: flex; align-items: center; gap: 16px; padding: 0 16px; overflow: hidden;
      background: linear-gradient(var(--surface-2), var(--surface));
      border-bottom: 1px solid var(--border); box-shadow: var(--sh-1); }
    .brand { display: flex; align-items: center; gap: 9px; font-weight: 650;
      letter-spacing: -.01em; white-space: nowrap; }
    .brand .mark { width: 17px; height: 17px; border-radius: 5px;
      background: conic-gradient(from 210deg, var(--accent), var(--k-method), var(--accent));
      box-shadow: 0 0 0 1px hsl(250 80% 70% / .35), 0 0 14px hsl(250 90% 65% / .4); }
    .brand small { color: var(--text-3); font-weight: 500; font-size: 11px; }

    .seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--bg);
      border: 1px solid var(--border); border-radius: 10px; }
    .seg button { appearance: none; background: transparent; color: var(--text-2);
      border: 0; border-radius: 7px; padding: 4px 13px; font: 500 12px var(--sans);
      cursor: pointer; transition: color .12s ease, background .12s ease; }
    .seg button:hover { color: var(--text); }
    .seg button.active { background: var(--surface-3); color: var(--text);
      box-shadow: var(--sh-1), inset 0 1px 0 hsl(228 20% 32% / .4); }

    .legend { margin-left: auto; display: flex; gap: 15px; color: var(--text-2);
      font: 500 11px var(--mono); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor;
      box-shadow: 0 0 7px currentColor; }
    .badge { display: none; gap: 10px; font: 600 11px var(--mono); }
    .badge.show { display: inline-flex; }
    .badge b { font-weight: 600; }

    .card { position: absolute; top: 60px; right: 16px; width: 304px; z-index: 40;
      background: var(--surface-2); border: 1px solid var(--border-2); border-radius: 12px;
      padding: 16px; box-shadow: var(--sh-2); max-height: calc(100% - 80px); overflow: auto; }
    .card.hidden { display: none; }
    .card h3 { margin: 0 0 9px; font: 600 14px var(--mono); letter-spacing: -.01em; word-break: break-all; }
    .card .kind { display: inline-block; padding: 2px 9px; border-radius: 999px;
      font: 600 10px var(--sans); text-transform: uppercase; letter-spacing: .05em;
      background: hsl(228 14% 16%); border: 1px solid var(--border-2); }
    .card .loc { color: var(--text-3); margin: 11px 0 2px; font: 12px var(--mono); word-break: break-all; }
    .card .group { margin-top: 13px; }
    .card .group b { display: block; margin-bottom: 5px; color: var(--text-2);
      font: 600 10px var(--sans); text-transform: uppercase; letter-spacing: .06em; }
    .card ul { margin: 0; padding: 0; list-style: none; }
    .card li { color: var(--text); font: 12px var(--mono); padding: 2px 0 2px 8px; margin: 4px 0;
      border-left: 2px solid var(--border-2); word-break: break-all; }

    /* Ranked change feed (FR-7 triage): highest blast-radius change first. */
    .feed { position: absolute; top: 60px; left: 16px; width: 288px; z-index: 40;
      display: flex; flex-direction: column; max-height: calc(100% - 80px);
      background: var(--surface-2); border: 1px solid var(--border-2); border-radius: 12px;
      box-shadow: var(--sh-2); overflow: hidden; }
    .feed.hidden { display: none; }
    .feed header { display: flex; align-items: baseline; gap: 8px; padding: 13px 15px 11px;
      border-bottom: 1px solid var(--border); }
    .feed header h3 { margin: 0; font: 600 13px var(--sans); letter-spacing: -.01em; }
    .feed header .count { color: var(--text-3); font: 500 11px var(--mono); }
    .feed header .hint { margin-left: auto; color: var(--text-3); font: 600 9px var(--sans);
      text-transform: uppercase; letter-spacing: .07em; }
    .feed ol { margin: 0; padding: 6px; list-style: none; overflow: auto; }
    .feed .row { display: grid; grid-template-columns: auto 1fr auto; align-items: center;
      gap: 10px; width: 100%; text-align: left; appearance: none; background: transparent;
      border: 0; border-radius: 8px; padding: 8px 9px; cursor: pointer; color: var(--text);
      box-shadow: inset 2px 0 0 0 transparent; transition: background .12s ease; }
    @media (hover: hover) { .feed .row:hover:not(.active) { background: var(--surface-3); } }
    .feed .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .feed .row.active { background: var(--surface-3); box-shadow: inset 2px 0 0 0 var(--accent); }
    .feed .chip { width: 7px; height: 7px; border-radius: 2px; box-shadow: 0 0 7px currentColor; }
    .feed .name { font: 500 12px var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .feed .name em { font-style: normal; color: var(--text-3); }
    .feed .blast { font: 600 11px var(--mono); color: var(--text-2); padding: 2px 7px;
      border-radius: 999px; background: var(--bg); border: 1px solid var(--border); white-space: nowrap; }
    .feed .blast.hot { color: var(--text); border-color: var(--accent); }
    @media (max-width: 600px) { .brand small, .legend, .feed { display: none; } }
  </style>
</head>
<body>
  <header class="topbar">
    <span class="brand"><i class="mark"></i>codegraph <small>knowledge graph</small></span>
    <nav class="seg">
      <button data-projection="full" class="active">Full</button>
      <button data-projection="dependency">Dependency</button>
      <button data-projection="structure">Structure</button>
      <button data-projection="call">Call</button>
    </nav>
    <span class="badge" id="badge"></span>
    <span class="legend">
      <span style="color:var(--k-module)"><i class="dot"></i>module</span>
      <span style="color:var(--k-class)"><i class="dot"></i>class</span>
      <span style="color:var(--k-function)"><i class="dot"></i>function</span>
      <span style="color:var(--k-method)"><i class="dot"></i>method</span>
    </span>
  </header>
  <div id="app"></div>
  <aside id="feed" class="feed hidden" aria-label="Ranked changes"></aside>
  <div id="card" class="card hidden"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
