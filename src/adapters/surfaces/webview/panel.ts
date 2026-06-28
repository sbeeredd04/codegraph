import * as vscode from "vscode";
import type { GraphNode, GraphEdge, GraphDelta } from "../../../core/graph/types.js";
import type { RankedChange } from "../../../core/graph/change-feed.js";
import type { NodeEnrichment } from "../../../core/semantic/enrichment.js";
import { projectGraph, type ProjectionKind } from "../../../core/graph/projection.js";
import { emptyDiagramSet, type DiagramSet } from "../../../core/diagrams/diagram.js";
import { buildDiagramPanel } from "./diagram-view.js";
import {
  buildRenderModel,
  changesFromDelta,
  deltaCounts,
  findOrphanAddresses,
  type RenderMessage,
} from "./render-model.js";

// Outbound surface (AD-2): a webview panel beside the editor. Holds the source
// graph and re-projects on toggle (FR-4); only renders, never mutates code (FR-9).
export class GraphPanel {
  private static panel: vscode.WebviewPanel | undefined;
  private static nodes: readonly GraphNode[] = [];
  private static edges: readonly GraphEdge[] = [];
  private static projection: ProjectionKind = "full";
  private static delta: GraphDelta | undefined;
  private static feed: readonly RankedChange[] | undefined;
  private static enrichments: ReadonlyMap<string, NodeEnrichment> | undefined;
  private static diagrams: DiagramSet | undefined;

  static show(
    context: vscode.ExtensionContext,
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    delta?: GraphDelta,
    feed?: readonly RankedChange[],
    enrichments?: ReadonlyMap<string, NodeEnrichment>,
    diagrams?: DiagramSet,
  ): void {
    this.nodes = nodes;
    this.edges = edges;
    this.delta = delta;
    this.feed = feed;
    this.enrichments = enrichments;
    this.diagrams = diagrams;
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
    // Orphan status is a property of the whole graph, not the current view — compute
    // it from the full edge set so a node doesn't look orphaned just because a
    // projection hid its only inbound edge (FR-12).
    const orphans = findOrphanAddresses(this.nodes, this.edges);
    const message: RenderMessage = {
      type: "render",
      version: 1,
      payload: buildRenderModel(
        projected.nodes,
        projected.edges,
        changes,
        counts,
        this.feed,
        this.enrichments,
        orphans,
      ),
      // Agent-authored knowledge diagrams (Epic 7) ride alongside the graph; they
      // don't depend on the projection, so they're sent whole on every repaint.
      diagrams: buildDiagramPanel(this.diagrams ?? emptyDiagramSet()),
      // The full node set for the ⌘K palette — projection-independent, so the
      // search can reach a node even while the active projection hides it.
      allNodes: this.nodes.map((n) => ({ address: n.address, name: n.name, kind: n.kind })),
      // The full edge set, so the trace-path lens can route over the whole graph
      // regardless of the active projection (PM-backlog #3).
      allEdges: this.edges,
    };
    void this.panel.webview.postMessage(message);
  }

  private static html(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "webview.js"),
    );
    // Vendored Mermaid global build (Epic 7). Loaded via its own <script> tag from
    // the webview's localResourceRoots — covered by `script-src ${cspSource}`. It
    // is fully self-contained (no runtime dynamic import()), so the strict CSP
    // (no 'unsafe-eval'/'unsafe-inline' on scripts) holds.
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "mermaid.min.js"),
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

    /* Orphan overlay toggle (FR-12): dim everything except dead-code candidates.
       Inactive reads as a quiet control; active picks up the same muted ochre as
       the card's orphan chip so the two surfaces speak the same visual language. */
    .tg { display: inline-flex; align-items: center; gap: 7px; appearance: none; cursor: pointer;
      background: var(--bg); color: var(--text-2); border: 1px solid var(--border);
      border-radius: 9px; padding: 5px 11px; font: 500 12px var(--sans); white-space: nowrap;
      transition: color .12s ease, background .12s ease, border-color .12s ease; }
    .tg:hover:not(:disabled) { color: var(--text); }
    .tg:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .tg:disabled { color: var(--text-3); cursor: default; }
    .tg .tgdot { width: 7px; height: 7px; border-radius: 50%;
      border: 1.5px solid currentColor; box-sizing: border-box; }
    .tg .n { font: 600 11px var(--mono); color: var(--text-3); }
    .tg.active { color: hsl(40 82% 72%); background: hsl(40 48% 14% / .5);
      border-color: hsl(40 60% 52% / .45); }
    .tg.active .n { color: hsl(40 82% 72%); }

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

    /* Agent annotation (Epic 4): the "what is this" answer, above the edge lists.
       Accent-tinted so the human reads it as an AI-written summary, not ground truth. */
    .card .enrich { margin: 12px 0 2px; padding: 11px 12px; border-radius: 9px;
      background: hsl(250 45% 16% / .32); border: 1px solid hsl(250 60% 60% / .22); }
    .card .enrich-head { margin-bottom: 7px; }
    .card .role { display: inline-block; padding: 2px 9px; border-radius: 999px;
      font: 600 9px var(--sans); text-transform: uppercase; letter-spacing: .06em;
      color: var(--accent); background: hsl(250 92% 71% / .12); border: 1px solid hsl(250 92% 71% / .32); }
    .card .summary { margin: 0; color: var(--text); font: 13px/1.55 var(--sans); text-wrap: pretty; }
    .card .intent { margin: 7px 0 0; color: var(--text-2); font: 12px/1.5 var(--sans); text-wrap: pretty; }

    /* Orphan note (FR-12): a calm caution chip for a dead-code candidate. A muted
       ochre, deliberately lower-energy than the change-overlay amber and not the
       only signal (the text carries the meaning), so it reads as a hint, not an alarm. */
    .card .orphan { display: inline-block; margin: 12px 0 2px; padding: 4px 10px;
      border-radius: 8px; color: hsl(40 82% 72%); background: hsl(40 48% 14% / .5);
      border: 1px solid hsl(40 60% 52% / .32); font: 600 11px var(--sans); letter-spacing: .005em; }

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

    /* Diagrams drawer (Epic 7): the agent-authored Mermaid knowledge diagrams. A
       right slide-over — detail-in-context, non-modal so the graph stays live
       behind it. The toggle's active accent (violet) deliberately differs from the
       orphan toggle's ochre so the two overlays never read as the same mode. */
    .tg.dg.active { color: var(--accent); background: hsl(250 60% 18% / .5);
      border-color: hsl(250 70% 60% / .45); }
    .tg.dg.active .n { color: var(--accent); }

    /* Trace-path toggle: violet active state, matching the highlighted route; the
       status pill (a live region) reports the picked source / found route. */
    .tg.trace.active { color: var(--accent); background: hsl(250 60% 18% / .5);
      border-color: hsl(250 70% 60% / .45); }
    .trace-status { font: 600 11px var(--mono); white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; max-width: 32ch; padding: 4px 9px; border-radius: 7px;
      color: var(--accent); background: hsl(250 45% 16% / .5); border: 1px solid hsl(250 70% 60% / .35); }
    .trace-status[hidden] { display: none; }
    .trace-status.none { color: hsl(2 72% 76%); background: hsl(2 45% 16% / .45);
      border-color: hsl(2 60% 52% / .38); }

    .drawer { position: absolute; top: 48px; right: 0; bottom: 0; width: min(560px, 86vw);
      z-index: 50; display: flex; flex-direction: column;
      background: linear-gradient(var(--surface-2), var(--surface));
      border-left: 1px solid var(--border-2); box-shadow: var(--sh-2);
      transform: translateX(100%); transition: transform .24s cubic-bezier(.22,.61,.36,1);
      overscroll-behavior: contain; }
    .drawer.open { transform: translateX(0); }
    .drawer.gone { display: none; }            /* fully removed until first opened */
    @media (prefers-reduced-motion: reduce) { .drawer { transition: none; } }

    .drawer > header { display: flex; align-items: center; gap: 9px; padding: 13px 15px;
      border-bottom: 1px solid var(--border); }
    .drawer > header h3 { margin: 0; font: 600 13px var(--sans); letter-spacing: -.01em; }
    .drawer > header .count { color: var(--text-3); font: 500 11px var(--mono); }
    .drawer .close { margin-left: auto; appearance: none; cursor: pointer; line-height: 1;
      background: transparent; color: var(--text-2); border: 1px solid var(--border);
      border-radius: 8px; width: 27px; height: 27px; font: 16px var(--sans);
      display: inline-flex; align-items: center; justify-content: center;
      transition: color .12s ease, background .12s ease; }
    .drawer .close:hover { color: var(--text); background: var(--surface-3); }
    .drawer .close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .dg-index { max-height: 38%; overflow: auto; padding: 6px 8px 10px;
      border-bottom: 1px solid var(--border); }
    .dg-group { margin-bottom: 4px; }
    .dg-cat { display: flex; align-items: center; gap: 8px; margin: 9px 6px 4px;
      color: var(--text-2); font: 600 10px var(--sans); text-transform: uppercase; letter-spacing: .07em; }
    .dg-cat .dg-n { color: var(--text-3); font: 600 10px var(--mono); }
    .dg-item { display: block; width: 100%; text-align: left; appearance: none;
      background: transparent; border: 0; border-radius: 8px; padding: 7px 10px; cursor: pointer;
      color: var(--text); box-shadow: inset 2px 0 0 0 transparent; transition: background .12s ease; }
    @media (hover: hover) { .dg-item:hover:not(.active) { background: var(--surface-3); } }
    .dg-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .dg-item.active { background: var(--surface-3); box-shadow: inset 2px 0 0 0 var(--accent); }
    .dg-title { display: block; font: 500 12px var(--sans); }
    .dg-desc { display: block; margin-top: 2px; color: var(--text-3); font: 11px/1.45 var(--sans);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .dg-stage { flex: 1; min-height: 0; overflow: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 12px; }
    .dg-stage-head { display: flex; align-items: baseline; gap: 9px; }
    .dg-stage-head h4 { margin: 0; font: 600 14px var(--sans); letter-spacing: -.01em; word-break: break-word; }
    .dg-stage-head .cat { color: var(--text-3); font: 600 9px var(--sans);
      text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
    /* Related-node chips (Epic 7.5c): jump from the diagram to the graph node. */
    .dg-related { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .dg-related[hidden] { display: none; }
    .dg-rel-label { color: var(--text-3); font: 600 9px var(--sans);
      text-transform: uppercase; letter-spacing: .06em; margin-right: 1px; }
    .dg-rel { appearance: none; cursor: pointer; max-width: 100%;
      background: var(--surface-3); color: var(--text-2); border: 1px solid var(--border-2);
      border-radius: 999px; padding: 3px 10px; font: 500 11px var(--mono); white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
      transition: color .12s ease, background .12s ease, border-color .12s ease; }
    .dg-rel:hover { color: var(--text); background: hsl(250 45% 16% / .55); border-color: hsl(250 70% 60% / .45); }
    .dg-rel:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .dg-render { flex: 1; min-height: 0; display: flex; align-items: flex-start; justify-content: center; }
    .dg-render svg { max-width: 100%; height: auto; }
    .dg-placeholder, .dg-empty { color: var(--text-3); font: 12px/1.6 var(--sans); align-self: center; }
    .dg-empty { align-self: stretch; }
    .dg-empty-title { margin: 2px 0 7px; color: var(--text-2); font: 600 13px var(--sans); }
    .dg-empty-body { margin: 0; max-width: 42ch; }
    .dg-empty code, .dg-err code { font: 11px var(--mono); color: var(--accent);
      background: hsl(250 45% 16% / .42); padding: 1px 5px; border-radius: 5px; }
    .dg-err { color: hsl(2 72% 74%); font: 12px/1.6 var(--sans); align-self: stretch; }
    .dg-err b { display: block; margin-bottom: 5px; color: hsl(2 72% 78%); font-weight: 600; }
    .dg-err pre { margin: 8px 0 0; padding: 9px 11px; overflow: auto; border-radius: 8px;
      background: var(--bg); border: 1px solid var(--border); color: var(--text-2);
      font: 11px/1.5 var(--mono); white-space: pre-wrap; word-break: break-word; }

    /* Command palette (PM-backlog #2): a ⌘K spotlight to fuzzy-jump to any node.
       WAI-ARIA combobox — the input keeps focus, the active row is tracked with
       aria-activedescendant, so there is no focus trap. Shared with the viewer. */
    .tg.search { gap: 7px; }
    .cp-kbd { font: 600 10px var(--mono); color: var(--text-3); background: var(--bg);
      border: 1px solid var(--border); border-radius: 5px; padding: 2px 5px; line-height: 1; }

    .cp-overlay { position: fixed; inset: 0; z-index: 70; display: flex;
      align-items: flex-start; justify-content: center; padding: 12vh 16px 16px;
      background: hsl(228 40% 3% / .55); backdrop-filter: blur(2px);
      opacity: 0; transition: opacity .14s ease; }
    .cp-overlay.open { opacity: 1; }
    .cp-overlay.gone { display: none; }
    .cp-dialog { width: min(560px, 100%); max-height: 62vh; display: flex; flex-direction: column;
      background: linear-gradient(var(--surface-2), var(--surface));
      border: 1px solid var(--border-2); border-radius: 14px; box-shadow: var(--sh-2);
      overflow: hidden; transform: translateY(-8px) scale(.99); transition: transform .14s ease; }
    .cp-overlay.open .cp-dialog { transform: none; }
    @media (prefers-reduced-motion: reduce) { .cp-overlay, .cp-dialog { transition: none; } }

    .cp-input-wrap { display: flex; align-items: center; gap: 10px; padding: 13px 14px;
      border-bottom: 1px solid var(--border); }
    .cp-search-icon { color: var(--text-3); flex: none; }
    .cp-input { flex: 1; min-width: 0; appearance: none; background: transparent; border: 0;
      outline: none; color: var(--text); font: 15px var(--sans); }
    .cp-input::placeholder { color: var(--text-3); }

    .cp-list { margin: 0; padding: 6px; list-style: none; overflow: auto; min-height: 0; }
    .cp-list[hidden] { display: none; }
    .cp-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
      gap: 10px; padding: 8px 10px; border-radius: 9px; cursor: pointer;
      box-shadow: inset 2px 0 0 0 transparent; }
    .cp-row.active { background: var(--surface-3); box-shadow: inset 2px 0 0 0 var(--accent); }
    .cp-kind { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex: none; }
    .cp-row[data-kind="module"] .cp-kind { background: var(--k-module); }
    .cp-row[data-kind="class"] .cp-kind { background: var(--k-class); }
    .cp-row[data-kind="function"] .cp-kind { background: var(--k-function); }
    .cp-row[data-kind="method"] .cp-kind { background: var(--k-method); }
    .cp-row[data-kind="workflow"] .cp-kind { background: var(--k-workflow); }
    .cp-name { font: 500 13px var(--mono); color: var(--text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cp-name mark { background: hsl(250 92% 71% / .24); color: var(--text); border-radius: 3px; padding: 0 1px; }
    .cp-path { font: 11px var(--mono); color: var(--text-3); justify-self: end; max-width: 46%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cp-empty { margin: 0; padding: 26px 16px; text-align: center; color: var(--text-2); font: 13px var(--sans); }
    .cp-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 8px 14px; border-top: 1px solid var(--border); }
    .cp-hint { color: var(--text-2); font: 600 11px var(--mono); }
    .cp-tip { color: var(--text-3); font: 11px var(--sans); }

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
    <button id="search-toggle" class="tg search" type="button"
      title="Search nodes by name (Cmd/Ctrl K)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
      </svg>Search<kbd class="cp-kbd">⌘K</kbd>
    </button>
    <button id="orphan-toggle" class="tg" type="button" aria-pressed="false" disabled
      title="Dim everything except dead-code candidates (nodes with no inbound references).">
      <i class="tgdot" aria-hidden="true"></i>Orphans<span class="n" id="orphan-count">0</span>
    </button>
    <button id="trace-toggle" class="tg trace" type="button" aria-pressed="false"
      title="Trace the shortest dependency path between two nodes — turn this on, then click a source node and a target node.">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="5" cy="19" r="2.4" /><circle cx="19" cy="5" r="2.4" /><path d="M7 17.5 17 6.5" />
      </svg>Trace
    </button>
    <span class="trace-status" id="trace-status" role="status" aria-live="polite" hidden></span>
    <button id="diagrams-toggle" class="tg dg" type="button" aria-pressed="false"
      aria-controls="diagrams" aria-expanded="false"
      title="Agent-authored Mermaid diagrams — the workflows, architecture, and sequences your AI drew from the graph.">
      <i class="tgdot" aria-hidden="true"></i>Diagrams<span class="n" id="diagrams-count">0</span>
    </button>
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
  <aside id="diagrams" class="drawer gone" role="region" aria-label="Agent-authored diagrams">
    <header>
      <h3>Diagrams</h3><span class="count" id="dg-count">0 diagrams</span>
      <button class="close" id="dg-close" type="button" aria-label="Close diagrams panel" title="Close (Esc)">&times;</button>
    </header>
    <div class="dg-index" id="dg-index"></div>
    <div class="dg-stage">
      <div class="dg-stage-head" id="dg-stage-head" hidden></div>
      <div class="dg-related" id="dg-related" hidden></div>
      <div class="dg-render" id="dg-render"></div>
    </div>
  </aside>
  <div id="palette" class="cp-overlay gone" role="presentation">
    <div id="cp-dialog" class="cp-dialog" role="dialog" aria-modal="true" aria-label="Search nodes">
      <div class="cp-input-wrap">
        <svg class="cp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input id="cp-input" class="cp-input" type="text" role="combobox" aria-expanded="true"
          aria-controls="cp-list" aria-autocomplete="list" autocomplete="off" spellcheck="false"
          placeholder="Jump to a node…" aria-label="Search nodes by name" />
        <kbd class="cp-kbd">Esc</kbd>
      </div>
      <ul id="cp-list" class="cp-list" role="listbox" aria-label="Matching nodes"></ul>
      <p id="cp-empty" class="cp-empty" hidden>No matching nodes.</p>
      <div class="cp-foot">
        <span id="cp-hint" class="cp-hint"></span>
        <span class="cp-tip" aria-hidden="true">↑↓ navigate · ↵ open · Esc close</span>
      </div>
    </div>
  </div>
  <script src="${mermaidUri}"></script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
