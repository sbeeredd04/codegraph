import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { GraphSnapshot } from "../../../core/graph/export.js";
import type { PresentationCommand } from "../../../core/presentation/command.js";
import { readCommandsFrom } from "../../presentation/disk-sink.js";
import { prepareExportHtml } from "./export-html.js";
import {
  commandMessage,
  ingestMessage,
  isIndexRequestMessage,
  isReadyMessage,
  parseOpenFileMessage,
  snapshotMessage,
  withTrailingSlash,
} from "./explorer-protocol.js";
import type { IngestEvent } from "../../../core/ingest/progress.js";

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
  // FR-39 slice B: the live presentation command bus. The standalone MCP server
  // (a separate process) APPENDS the agent's ephemeral view directives to a
  // host-local transient queue; while this panel is open we TAIL that queue and
  // forward each command to the webview, where the bridge re-validates and the
  // surface controller executes it. The directives drive the view only — never
  // serialized into a snapshot (AD-14), never touch source (FR-9).
  private static commandWatcher: fs.FSWatcher | undefined;
  private static commandOffset = 0;
  // FR-55: the live-ingestion trigger. The board's "Index" button posts a
  // `codegraph:indexRepo` request; the extension registers the actual scan here
  // (it owns bootstrapRepo + the workspace root — AD-16). The scan streams coarse
  // progress back via {@link postIngest}, which the export's live-progress UI
  // binds to. Kept as a handler (not a direct import of bootstrapRepo) so this
  // adapter never reaches across into the language/fs layer.
  private static indexHandler: (() => void) | undefined;

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

  static show(context: vscode.ExtensionContext, snapshot: GraphSnapshot, commandsPath?: string): void {
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
        this.commandWatcher?.close();
        this.commandWatcher = undefined;
        this.indexHandler = undefined;
        this.panel = undefined;
        this.snapshot = undefined;
      });
      // The Next app announces readiness (webview-bridge.ts), then we hand it the
      // live graph — mirroring the bespoke panel's ready/render handshake.
      this.panel.webview.onDidReceiveMessage((msg: unknown) => {
        if (isReadyMessage(msg)) {
          this.send();
          return;
        }
        // FR-55 user trigger: the board asked to (re)index this workspace. The
        // host owns the root + scan options, so the request carries no payload —
        // we just run the registered scan, which streams progress back.
        if (isIndexRequestMessage(msg)) {
          this.indexHandler?.();
          return;
        }
        const open = parseOpenFileMessage(msg);
        if (open) this.revealInEditor(open.file, open.line, open.column);
      });
    } else {
      this.panel.reveal(column);
    }

    this.panel.webview.html = this.html(context, this.panel.webview);
    if (commandsPath) this.watchCommands(commandsPath);
  }

  /**
   * Forward one live presentation command to the webview (FR-39). Wrapped in its
   * `codegraph:command` envelope — graph-identity addresses + view directives only,
   * no source, no host path — so it stays cloud-safe (AD-14) and read-only (FR-9).
   * No-op when the panel is closed.
   */
  static postCommand(command: PresentationCommand): void {
    void this.panel?.webview.postMessage(commandMessage(command));
  }

  /**
   * Stream one live repo-ingestion progress tick to the webview (FR-55). The
   * envelope carries ONLY counts + a repo-relative current file — never source
   * bytes / an absolute host path (AD-16 / AD-14) — so the export's live-progress
   * UI renders without a host round-trip. A malformed event is dropped by
   * `ingestMessage` rather than posted; a no-op when the panel is closed.
   */
  static postIngest(event: IngestEvent): void {
    const msg = ingestMessage(event);
    if (msg) void this.panel?.webview.postMessage(msg);
  }

  /**
   * Register the scan the board's "Index" button triggers (FR-55 user trigger).
   * The extension owns `bootstrapRepo` + the workspace root (AD-16), so it supplies
   * the handler; it should stream progress back through {@link postIngest}. Holds a
   * single handler — re-registering replaces it (the active workspace's scanner).
   */
  static onIndexRequest(handler: () => void): void {
    this.indexHandler = handler;
  }

  /**
   * Tail the agent's transient command queue and forward each new directive to the
   * webview. Seeds the read offset at the file's CURRENT size so the backlog never
   * replays — only directives the agent issues while the board is open drive it.
   *
   * The watch + forward leg runs only inside the Extension Development Host (a live
   * webview + a connected MCP writer), so it is verified there, not headlessly; the
   * drain/validate it calls (`readCommandsFrom`) IS unit-tested. Degrades silently:
   * a watch that can't be established just leaves the board human-driven.
   */
  private static watchCommands(commandsPath: string): void {
    this.commandWatcher?.close();
    this.commandWatcher = undefined;
    try {
      // Ensure the file exists so fs.watch doesn't ENOENT before the first emit
      // (the panel may open before the MCP writer ever runs), then start past the
      // backlog so only live directives forward.
      fs.mkdirSync(path.dirname(commandsPath), { recursive: true });
      fs.appendFileSync(commandsPath, "");
      this.commandOffset = fs.statSync(commandsPath).size;
      this.commandWatcher = fs.watch(commandsPath, () => this.drainCommands(commandsPath));
    } catch {
      // No queue yet / unwatchable FS → the human simply keeps the wheel.
    }
  }

  /** Drain any whole commands appended since the last offset. A `reveal` (FR-78)
   *  drives the real EDITOR, so the host handles it here (resolve address → file:line
   *  → showTextDocument) and never forwards it to the board; every other command is
   *  a view directive forwarded to the webview. */
  private static drainCommands(commandsPath: string): void {
    if (!this.panel) return;
    const { commands, offset } = readCommandsFrom(commandsPath, this.commandOffset);
    this.commandOffset = offset;
    for (const command of commands) {
      if (command.kind === "reveal") this.revealNode(command.address);
      else this.postCommand(command);
    }
  }

  /** FR-78: resolve a node address to its repo-relative location in the current
   *  snapshot and reveal it in the editor (same guarded path as the FR-31 request).
   *  Unknown address → no-op. The address→location lookup is source-blind (identity
   *  + relative path only); the reveal itself runs only in the live Dev Host. */
  private static revealNode(address: string): void {
    const node = this.snapshot?.nodes.find((n) => n.address === address);
    if (!node) return;
    this.revealInEditor(node.location.file, node.location.line, node.location.character);
  }

  private static send(): void {
    if (!this.panel || !this.snapshot) return;
    // The host owns the source (AD-16), so it — and only it — knows the absolute
    // repo root the webview needs to deep-link a file into the editor (FR-32).
    // Passed at the transport layer, never baked into the portable snapshot.
    const editorRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    void this.panel.webview.postMessage(snapshotMessage(this.snapshot, editorRoot));
  }

  /**
   * Reveal a repo-relative file in the editor at the webview's request (FR-31).
   * The host owns the source + the absolute root (AD-16), so it resolves the
   * relative path here — the webview only ever posts the relative file, so the
   * host path never enters the webview DOM. `parseOpenFileMessage` already string-
   * guarded the path (no absolute, no `..`); this re-checks that the RESOLVED path
   * stays inside the workspace root as defense in depth before opening it.
   *
   * The reveal itself runs only inside the Extension Development Host (a live
   * webview posting the request), so it is staged + verified there, not headlessly;
   * the path safeguard it relies on IS unit-tested (explorer-protocol.test.ts).
   * Read-only — it opens the file, never writes (FR-9). Best-effort: a failed open
   * is swallowed so a stale path can't break the panel.
   */
  private static revealInEditor(file: string, line?: number, column?: number): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const abs = path.resolve(root, file);
    const rel = path.relative(root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return; // escaped the root
    const position = new vscode.Position(line ?? 0, column ?? 0);
    void Promise.resolve(
      vscode.window.showTextDocument(vscode.Uri.file(abs), {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
        selection: new vscode.Range(position, position),
      }),
    ).then(undefined, () => undefined);
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
