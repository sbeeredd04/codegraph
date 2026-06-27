import * as vscode from "vscode";
import type { RenderModel, RenderMessage } from "./render-model.js";

// Outbound surface (AD-2): a webview panel beside the editor. It only renders
// the model it's given and posts `ready`; it never mutates code (FR-9).
export class GraphPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static pending: RenderModel | undefined;

  static show(context: vscode.ExtensionContext, model: RenderModel): void {
    this.pending = model;
    const column = vscode.ViewColumn.Beside;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("codegraph", "codegraph", column, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      });
      this.panel.onDidDispose(() => (this.panel = undefined));
      // Webview announces readiness, then we push the current model — avoids a load race.
      this.panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
        if (msg?.type === "ready" && this.pending) {
          const render: RenderMessage = { type: "render", version: 1, payload: this.pending };
          void this.panel?.webview.postMessage(render);
        }
      });
    } else {
      this.panel.reveal(column);
    }

    this.panel.webview.html = this.html(context, this.panel.webview);
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
    html, body { height: 100%; margin: 0; background: #0d1117; }
    #app { position: absolute; inset: 0; }
    .legend {
      position: absolute; top: 10px; left: 12px; z-index: 2;
      font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #8b949e;
    }
    .legend span { margin-right: 12px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  </style>
</head>
<body>
  <div class="legend">
    <span><i class="dot" style="background:#7aa2f7"></i>module</span>
    <span><i class="dot" style="background:#bb9af7"></i>class</span>
    <span><i class="dot" style="background:#9ece6a"></i>function</span>
    <span><i class="dot" style="background:#7dcfff"></i>method</span>
  </div>
  <div id="app"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
