import * as vscode from "vscode";
import { CodeGraph } from "../core/graph/graph.js";

// Extension host = composition root. It wires adapters to the pure core (AD-1).
// The core never imports vscode; this file may.

export function activate(context: vscode.ExtensionContext): void {
  const open = vscode.commands.registerCommand("codegraph.open", () => {
    // Placeholder until the webview surface (Story 1.4). Prove the core is reachable.
    const graph = new CodeGraph();
    vscode.window.showInformationMessage(
      `codegraph: graph ready (${graph.order} nodes). Panel coming in Story 1.4.`,
    );
  });

  context.subscriptions.push(open);
}

export function deactivate(): void {
  // no-op
}
