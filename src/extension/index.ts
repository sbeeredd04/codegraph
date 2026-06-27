import * as vscode from "vscode";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { LanguageAdapter } from "../core/ports.js";
import { createTypeScriptAdapter } from "../adapters/lang/typescript/index.js";
import { bootstrapRepo, type BootstrapOptions } from "../adapters/lang/bootstrap.js";
import { diffGraphs } from "../core/graph/diff.js";
import { rankedChangeFeed } from "../core/graph/change-feed.js";
import type { CodeGraph } from "../core/graph/graph.js";
import { GraphPanel } from "../adapters/surfaces/webview/panel.js";

// Extension host = composition root (AD-1). It wires adapters to the pure core;
// the core never imports vscode.

const require = createRequire(__filename);

function wasmDir(): string {
  return path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
}

export function activate(context: vscode.ExtensionContext): void {
  let adapter: Promise<LanguageAdapter> | undefined;
  let current: { folderPath: string; graph: CodeGraph; options: BootstrapOptions } | undefined;

  const readOptions = (): BootstrapOptions => {
    const cfg = vscode.workspace.getConfiguration("codegraph");
    return {
      typescript: cfg.get<boolean>("languages.typescript", true),
      python: cfg.get<boolean>("languages.python", true),
      exclude: cfg.get<string[]>("exclude", []),
    };
  };

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
        const options = readOptions();
        const { graph, coverage } = await bootstrapRepo(folder.uri.fsPath, wasmDir(), options);
        if (graph.order === 0) {
          void vscode.window.showInformationMessage(
            "codegraph: no source files found for the enabled languages in this workspace.",
          );
          return;
        }
        current = { folderPath: folder.uri.fsPath, graph, options };
        GraphPanel.show(context, graph.allNodes(), graph.allEdges());
        void vscode.window.showInformationMessage(
          `codegraph: ${coverage.parsed}/${coverage.found} files · ${graph.order} nodes · ${graph.size} edges`,
        );
      },
    );
  });

  const refresh = vscode.commands.registerCommand("codegraph.refresh", async () => {
    if (!current) {
      void vscode.window.showWarningMessage("codegraph: open the workspace graph first.");
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "codegraph: re-scanning…" },
      async () => {
        const active = current as { folderPath: string; graph: CodeGraph; options: BootstrapOptions };
        const { graph: next } = await bootstrapRepo(active.folderPath, wasmDir(), active.options);
        const delta = diffGraphs(active.graph, next);
        const feed = rankedChangeFeed(delta, active.graph, next);
        current = { ...active, graph: next };
        GraphPanel.show(context, next.allNodes(), next.allEdges(), delta, feed);
        const total =
          delta.added.length + delta.removed.length + delta.changed.length + delta.movedRenamed.length;
        void vscode.window.showInformationMessage(
          total === 0
            ? "codegraph: no changes since the last view."
            : `codegraph: +${delta.added.length} added · ~${delta.changed.length} changed · ${delta.movedRenamed.length} moved · −${delta.removed.length} removed`,
        );
      },
    );
  });

  context.subscriptions.push(open, openWorkspace, refresh);
}

export function deactivate(): void {
  // no-op
}
