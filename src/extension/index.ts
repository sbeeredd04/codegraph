import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import type { LanguageAdapter } from "../core/ports.js";
import { createTypeScriptAdapter } from "../adapters/lang/typescript/index.js";
import { bootstrapRepo, type BootstrapOptions } from "../adapters/lang/bootstrap.js";
import { diffGraphs } from "../core/graph/diff.js";
import { rankedChangeFeed } from "../core/graph/change-feed.js";
import { createCoalescer, type Coalescer } from "../core/watch/coalescer.js";
import { baselineGraph } from "../adapters/git/baseline.js";
import { mcpConfigSnippet } from "../adapters/mcp/config.js";
import { exportGraphSnapshot } from "../core/graph/export.js";
import { buildMarkdownReport } from "../core/report/report.js";
import { createNodeAnnotations } from "../core/semantic/annotations.js";
import { diskEnrichmentCache } from "../adapters/semantic/disk-cache.js";
import { enrichmentCachePath } from "../adapters/semantic/cache-path.js";
import { diskDiagramStore } from "../adapters/diagrams/disk-store.js";
import { diagramsCachePath } from "../adapters/diagrams/cache-path.js";
import { emptyDiagramSet, type DiagramSet } from "../core/diagrams/diagram.js";
import type { CodeGraph } from "../core/graph/graph.js";
import type { GraphDelta } from "../core/graph/types.js";
import type { RankedChange } from "../core/graph/change-feed.js";
import type { NodeEnrichment } from "../core/semantic/enrichment.js";
import { GraphPanel } from "../adapters/surfaces/webview/panel.js";
import { ExplorerPanel } from "../adapters/surfaces/webview/explorer-panel.js";

// Extension host = composition root (AD-1). It wires adapters to the pure core;
// the core never imports vscode.

const require = createRequire(__filename);

// Quiet window before a burst of saves triggers one re-scan (the live Job B).
const WATCH_DEBOUNCE_MS = 400;
// Paths the graph never includes — skip them before debouncing to avoid churn.
const WATCH_IGNORE = /[/\\](node_modules|\.git|dist|\.venv|__pycache__)[/\\]/;

function wasmDir(): string {
  return path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
}

function deltaSummary(delta: GraphDelta, none: string): string {
  const total =
    delta.added.length + delta.removed.length + delta.changed.length + delta.movedRenamed.length;
  return total === 0
    ? none
    : `codegraph: +${delta.added.length} added · ~${delta.changed.length} changed · ` +
        `${delta.movedRenamed.length} moved · −${delta.removed.length} removed`;
}

// The agent's annotations live in a shared per-repo cache (the MCP server writes
// them via annotate_node). Read them back for this graph so the board's
// capability card can show each node's summary/intent/role (Epic 4). Returns
// empty immediately when no cache exists yet, keeping the watch loop snappy.
async function readEnrichments(folderPath: string, graph: CodeGraph): Promise<Map<string, NodeEnrichment>> {
  const map = new Map<string, NodeEnrichment>();
  const cachePath = enrichmentCachePath(folderPath);
  if (!fs.existsSync(cachePath)) return map;
  const annotations = createNodeAnnotations(() => graph, diskEnrichmentCache(cachePath));
  for (const node of graph.allNodes()) {
    const enrichment = await annotations.get(node.address);
    if (enrichment) map.set(node.address, enrichment);
  }
  return map;
}

// The agent's Mermaid diagrams live in a per-repo cache the MCP server writes via
// save_diagram (Epic 7). Read them back so the board's Diagrams drawer can render
// them. Returns an empty set immediately when no cache exists yet; the disk store
// degrades to empty on a corrupt/unreadable file, so the board never breaks on
// bad input. Read-only — the board renders diagrams, never edits source (FR-9).
async function readDiagrams(folderPath: string): Promise<DiagramSet> {
  const cachePath = diagramsCachePath(folderPath);
  if (!fs.existsSync(cachePath)) return emptyDiagramSet();
  return diskDiagramStore(cachePath).all();
}

// Repaint the board for a workspace graph, folding in the agent's annotations and
// any Mermaid diagrams the agent has authored.
async function showGraph(
  context: vscode.ExtensionContext,
  folderPath: string,
  graph: CodeGraph,
  delta?: GraphDelta,
  feed?: readonly RankedChange[],
): Promise<void> {
  const [enrichments, diagrams] = await Promise.all([
    readEnrichments(folderPath, graph),
    readDiagrams(folderPath),
  ]);
  GraphPanel.show(context, graph.allNodes(), graph.allEdges(), delta, feed, enrichments, diagrams);
}

export function activate(context: vscode.ExtensionContext): void {
  let adapter: Promise<LanguageAdapter> | undefined;
  let current: { folderPath: string; graph: CodeGraph; options: BootstrapOptions } | undefined;
  let watcher: vscode.FileSystemWatcher | undefined;
  let coalescer: Coalescer | undefined;
  let scanning = false;
  let dirty = false;

  const readOptions = (): BootstrapOptions => {
    const cfg = vscode.workspace.getConfiguration("codegraph");
    return {
      typescript: cfg.get<boolean>("languages.typescript", true),
      python: cfg.get<boolean>("languages.python", true),
      exclude: cfg.get<string[]>("exclude", []),
    };
  };

  // Re-scan the active workspace, diff against the prior graph, and repaint.
  // In silent mode (the live watcher) the panel only repaints on a real delta,
  // so no-op saves never disturb the view. Returns the delta (or undefined).
  const rescan = async (silent: boolean): Promise<GraphDelta | undefined> => {
    if (!current) return undefined;
    const active = current;
    const { graph: next } = await bootstrapRepo(active.folderPath, wasmDir(), active.options);
    const delta = diffGraphs(active.graph, next);
    const changed =
      delta.added.length + delta.removed.length + delta.changed.length + delta.movedRenamed.length > 0;
    current = { ...active, graph: next };
    if (!silent || changed) {
      const feed = rankedChangeFeed(delta, active.graph, next);
      await showGraph(context, active.folderPath, next, delta, feed);
    }
    return delta;
  };

  // Serialize scans: a flush mid-scan marks the run dirty and re-fires once after.
  const runScan = async (silent: boolean): Promise<GraphDelta | undefined> => {
    if (scanning) {
      dirty = true;
      return undefined;
    }
    scanning = true;
    try {
      return await rescan(silent);
    } finally {
      scanning = false;
      if (dirty) {
        dirty = false;
        void runScan(true);
      }
    }
  };

  // Passive running job (FR-7/FR-9): watch source files, coalesce save bursts,
  // and re-scan in the background. Read-only — never mutates the workspace.
  const startWatching = (folderPath: string): void => {
    watcher?.dispose();
    coalescer?.dispose();
    coalescer = createCoalescer(WATCH_DEBOUNCE_MS, () => void runScan(true));
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folderPath, "**/*.{ts,tsx,mts,cts,js,jsx,py}"),
    );
    const onEvent = (uri: vscode.Uri): void => {
      if (!WATCH_IGNORE.test(uri.fsPath)) coalescer?.notify(uri.fsPath);
    };
    watcher.onDidChange(onEvent);
    watcher.onDidCreate(onEvent);
    watcher.onDidDelete(onEvent);
    context.subscriptions.push(watcher);
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
        await showGraph(context, folder.uri.fsPath, graph);
        startWatching(folder.uri.fsPath);
        void vscode.window.showInformationMessage(
          `codegraph: ${coverage.parsed}/${coverage.found} files · ${graph.order} nodes · ${graph.size} edges · watching for changes`,
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
        const delta = await runScan(false);
        if (delta) {
          void vscode.window.showInformationMessage(
            deltaSummary(delta, "codegraph: no changes since the last view."),
          );
        }
      },
    );
  });

  // Diff the working tree against a git ref (Story 2.5): see what changed since
  // HEAD / a branch the moment the graph opens, no in-session edit needed.
  const diffBaseline = vscode.commands.registerCommand("codegraph.diffBaseline", async () => {
    if (!current) {
      void vscode.window.showWarningMessage("codegraph: open the workspace graph first.");
      return;
    }
    const ref = await vscode.window.showInputBox({
      title: "codegraph: diff working tree against…",
      prompt: "A git ref to use as the baseline (commit, branch, or tag).",
      value: "HEAD",
      ignoreFocusOut: true,
    });
    if (!ref) return; // cancelled
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `codegraph: diffing against ${ref}…` },
      async () => {
        const active = current as { folderPath: string; graph: CodeGraph; options: BootstrapOptions };
        try {
          const baseline = await baselineGraph(active.folderPath, ref, wasmDir(), active.options);
          const delta = diffGraphs(baseline, active.graph);
          const feed = rankedChangeFeed(delta, baseline, active.graph);
          await showGraph(context, active.folderPath, active.graph, delta, feed);
          void vscode.window.showInformationMessage(
            deltaSummary(delta, `codegraph: working tree matches ${ref}.`),
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            err instanceof Error ? err.message : `codegraph: could not diff against ${ref}.`,
          );
        }
      },
    );
  });

  // Copy the MCP client config (FR-13 last mile): one click to point the user's
  // AI agent at the codegraph server for this workspace.
  const copyMcpConfig = vscode.commands.registerCommand("codegraph.copyMcpConfig", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage("codegraph: open a folder/workspace first.");
      return;
    }
    const serverPath = path.join(context.extensionPath, "dist", "mcp-server.js");
    const repoRoot = current?.folderPath ?? folder.uri.fsPath;
    const snippet = mcpConfigSnippet(serverPath, repoRoot);
    await vscode.env.clipboard.writeText(snippet);
    const choice = await vscode.window.showInformationMessage(
      "codegraph: MCP config copied. Paste it into your agent's MCP settings to query the graph.",
      "Show config",
    );
    if (choice === "Show config") {
      const doc = await vscode.workspace.openTextDocument({ language: "json", content: snippet });
      void vscode.window.showTextDocument(doc);
    }
  });

  // Export a portable JSON snapshot of the graph (Epic 6 foundation): the data
  // contract the standalone web viewer consumes, and a shareable artifact on its
  // own. Writes a new file the user picks — never touches source code (FR-9).
  const exportGraph = vscode.commands.registerCommand("codegraph.exportGraph", async () => {
    if (!current) {
      void vscode.window.showWarningMessage("codegraph: open the workspace graph first.");
      return;
    }
    const active = current;
    const [enrichments, diagramSet] = await Promise.all([
      readEnrichments(active.folderPath, active.graph),
      readDiagrams(active.folderPath),
    ]);
    const snapshot = exportGraphSnapshot(active.graph.allNodes(), active.graph.allEdges(), {
      enrichments,
      diagrams: diagramSet.diagrams,
      generatedAt: new Date().toISOString(),
      root: active.folderPath,
    });
    const target = await vscode.window.showSaveDialog({
      title: "codegraph: export graph snapshot",
      defaultUri: vscode.Uri.joinPath(vscode.Uri.file(active.folderPath), "codegraph-graph.json"),
      filters: { JSON: ["json"] },
    });
    if (!target) return; // cancelled
    try {
      const json = JSON.stringify(snapshot, null, 2);
      await vscode.workspace.fs.writeFile(target, Buffer.from(json, "utf8"));
      const diagramNote = snapshot.diagrams?.length ? ` · ${snapshot.diagrams.length} diagrams` : "";
      void vscode.window.showInformationMessage(
        `codegraph: exported ${snapshot.nodeCount} nodes · ${snapshot.edgeCount} edges${diagramNote} to ${path.basename(target.fsPath)}.`,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        err instanceof Error ? err.message : "codegraph: could not write the export.",
      );
    }
  });

  // Export a shareable Markdown architecture report: the snapshot's structure plus
  // the agent's annotations and Mermaid diagrams, in one doc that renders natively
  // on GitHub and in the VS Code preview — the concrete "knowledge bridge" artifact.
  const exportReport = vscode.commands.registerCommand("codegraph.exportReport", async () => {
    if (!current) {
      void vscode.window.showWarningMessage("codegraph: open the workspace graph first.");
      return;
    }
    const active = current;
    const [enrichments, diagramSet] = await Promise.all([
      readEnrichments(active.folderPath, active.graph),
      readDiagrams(active.folderPath),
    ]);
    const snapshot = exportGraphSnapshot(active.graph.allNodes(), active.graph.allEdges(), {
      enrichments,
      diagrams: diagramSet.diagrams,
      generatedAt: new Date().toISOString(),
      root: active.folderPath,
    });
    const markdown = buildMarkdownReport(snapshot);
    const target = await vscode.window.showSaveDialog({
      title: "codegraph: export architecture report",
      defaultUri: vscode.Uri.joinPath(vscode.Uri.file(active.folderPath), "ARCHITECTURE.md"),
      filters: { Markdown: ["md"] },
    });
    if (!target) return; // cancelled
    try {
      await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, "utf8"));
      const diagramNote = snapshot.diagrams?.length ? ` · ${snapshot.diagrams.length} diagrams` : "";
      const annotationNote = enrichments?.size ? ` · ${enrichments.size} annotations` : "";
      void vscode.window.showInformationMessage(
        `codegraph: wrote architecture report (${snapshot.nodeCount} nodes${diagramNote}${annotationNote}) to ${path.basename(target.fsPath)}.`,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        err instanceof Error ? err.message : "codegraph: could not write the report.",
      );
    }
  });

  // Open the unified explorer (Epic 7.4): the SAME Next.js app the web serves,
  // hosted in the webview from one codebase. Kept on its own command — distinct
  // from the bespoke board (codegraph.openWorkspace) — until the Next explorer
  // reaches parity, so it never regresses the diagrams/index/feed surfaces
  // (PARITY WATCH). Only the graph snapshot is posted; source stays host-local.
  const openExplorer = vscode.commands.registerCommand("codegraph.openExplorer", async () => {
    if (!current) {
      void vscode.window.showWarningMessage("codegraph: open the workspace graph first.");
      return;
    }
    if (!ExplorerPanel.isAvailable(context)) {
      void vscode.window.showWarningMessage(
        "codegraph: the unified explorer isn't bundled in this build. Run `npm run build:explorer` to include it.",
      );
      return;
    }
    const active = current;
    const [enrichments, diagramSet] = await Promise.all([
      readEnrichments(active.folderPath, active.graph),
      readDiagrams(active.folderPath),
    ]);
    const snapshot = exportGraphSnapshot(active.graph.allNodes(), active.graph.allEdges(), {
      enrichments,
      diagrams: diagramSet.diagrams,
      generatedAt: new Date().toISOString(),
      root: active.folderPath,
    });
    ExplorerPanel.show(context, snapshot);
  });

  context.subscriptions.push(open, openWorkspace, refresh, diffBaseline, copyMcpConfig, exportGraph, exportReport, openExplorer, {
    dispose: () => {
      watcher?.dispose();
      coalescer?.dispose();
    },
  });
}

export function deactivate(): void {
  // no-op
}
