import * as vscode from "vscode";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { LanguageAdapter } from "../core/ports.js";
import { createTypeScriptAdapter } from "../adapters/lang/typescript/index.js";
import { bootstrapRepo } from "../adapters/lang/bootstrap.js";
import { GraphPanel } from "../adapters/surfaces/webview/panel.js";

// Extension host = composition root (AD-1). It wires adapters to the pure core;
// the core never imports vscode.

const require = createRequire(__filename);

function wasmDir(): string {
  return path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
}

export function activate(context: vscode.ExtensionContext): void {
  let adapter: Promise<LanguageAdapter> | undefined;

  const open = vscode.commands.registerCommand("codegraph.open", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !/typescript|javascript/.test(editor.document.languageId)) {
      void vscode.window.showWarningMessage("codegraph: open a TypeScript/JavaScript file, then run the command.");
      return;
    }
    adapter ??= createTypeScriptAdapter(wasmDir());
    const ts = await adapter;
    const doc = editor.document;
    const rel = vscode.workspace.asRelativePath(doc.uri);
    const { nodes, edges } = ts.parseFile(rel, doc.getText());
    GraphPanel.show(context, nodes, edges);
  });

  const openWorkspace = vscode.commands.registerCommand("codegraph.openWorkspace", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage("codegraph: open a folder/workspace first.");
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "codegraph: bootstrapping graph…" },
      async () => {
        const { graph, coverage } = await bootstrapRepo(folder.uri.fsPath, wasmDir());
        GraphPanel.show(context, graph.allNodes(), graph.allEdges());
        void vscode.window.showInformationMessage(
          `codegraph: ${coverage.parsed}/${coverage.found} files · ${graph.order} nodes · ${graph.size} edges`,
        );
      },
    );
  });

  context.subscriptions.push(open, openWorkspace);
}

export function deactivate(): void {
  // no-op
}
