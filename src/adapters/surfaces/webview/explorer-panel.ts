import * as vscode from "vscode";
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import type { GraphSnapshot } from "../../../core/graph/export.js";
import { prepareExportHtml } from "./export-html.js";
import { isReadyMessage, snapshotMessage, withTrailingSlash } from "./explorer-protocol.js";

// Epic 7.4 — the unified-surface explorer panel. Unlike the bespoke GraphPanel
// (which loads the hand-built media/webview.js), this hosts the SAME Next.js
// static export the web app serves (frontend/out → media/explorer), so the
// webview and the website render from one codebase.
//
// It lives BEHIND ITS OWN COMMAND while the Next explorer reaches feature parity
// with the bespoke surface (diagrams drawer / knowledge index / change feed /
// enrichment card), so opening it never silently regresses those (PARITY WATCH).
//
// Source never leaves the host: only the GraphSnapshot (identities + structure)
// is posted to the webview, and the export suppresses its bundled sample once a
// live snapshot arrives (AD-14 / AD-16).
export class ExplorerPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static snapshot: GraphSnapshot | undefined;

  /** Where esbuild copies the Next export inside the extension distributable. */
  private static exportDir(context: vscode.ExtensionContext): vscode.Uri {
    return vscode.Uri.joinPath(context.extensionUri, "media", "explorer");
  }

  /**
   * Whether the export was bundled into this build. A core-only build (no
   * `frontend/out`) ships without it, so the command degrades to a friendly
   * message instead of throwing when it reads index.html.
   */
  static isAvailable(context: vscode.ExtensionContext): boolean {
    return fs.existsSync(vscode.Uri.joinPath(this.exportDir(context), "index.html").fsPath);
  }

  static show(context: vscode.ExtensionContext, snapshot: GraphSnapshot): void {
    this.snapshot = snapshot;
    const column = vscode.ViewColumn.Beside;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "codegraphExplorer",
        "codegraph Explorer",
        column,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.exportDir(context)],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.snapshot = undefined;
      });
      // The Next app announces readiness (webview-bridge.ts), then we hand it the
      // live graph — mirroring the bespoke panel's ready/render handshake.
      this.panel.webview.onDidReceiveMessage((msg: unknown) => {
        if (isReadyMessage(msg)) this.send();
      });
    } else {
      this.panel.reveal(column);
    }

    this.panel.webview.html = this.html(context, this.panel.webview);
  }

  private static send(): void {
    if (!this.panel || !this.snapshot) return;
    // The host owns the source (AD-16), so it — and only it — knows the absolute
    // repo root the webview needs to deep-link a file into the editor (FR-32).
    // Passed at the transport layer, never baked into the portable snapshot.
    const editorRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    void this.panel.webview.postMessage(snapshotMessage(this.snapshot, editorRoot));
  }

  private static html(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const exportDir = this.exportDir(context);
    const indexHtml = fs.readFileSync(vscode.Uri.joinPath(exportDir, "index.html").fsPath, "utf8");
    // Mount the export under its own dir, lock it behind a strict per-load nonce
    // CSP, and let its relative URLs resolve against the webview origin (the same
    // recipe proven by export-html.test.ts + the webview-csp smoke test).
    const baseHref = withTrailingSlash(webview.asWebviewUri(exportDir).toString());
    const nonce = randomBytes(16).toString("base64");
    return prepareExportHtml(indexHtml, { baseHref, cspSource: webview.cspSource, nonce });
  }
}
