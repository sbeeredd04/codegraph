import * as vscode from "vscode";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { LanguageAdapter } from "../core/ports.js";
import { createTypeScriptAdapter } from "../adapters/lang/typescript/index.js";
import { buildRenderModel } from "../adapters/surfaces/webview/render-model.js";
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
    GraphPanel.show(context, buildRenderModel(nodes, edges));
  });

  context.subscriptions.push(open);
}

export function deactivate(): void {
  // no-op
}
