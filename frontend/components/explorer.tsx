"use client";

// Explorer shell — the interactive product surface. Owns the view state
// (projection, orphan overlay, trace arming, selection) and composes the
// GraphCanvas with a neutral toolbar + node-detail panel. Styling is
// deliberately neutral/dark here; the branded interface is layered on once the
// Better Design system is wired (held per the user's "claim the account first"
// choice). All graph logic lives in the canvas / pure core — this is glue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ProjectionKind } from "@core/graph/projection";
import type { GraphNode, GraphEdge } from "@core/graph/types";
import type { Diagram } from "@core/diagrams/diagram";
import type { Doc } from "@core/docs/doc";
import type { Overlay } from "@core/overlays/overlay";
import { nodeOverlays, overlayHighlights, OVERLAY_SET_VERSION } from "@core/overlays/overlay";
import { MARK_CANVAS_COLOR } from "@/lib/overlay-style";
import { displayLabel } from "@adapters/surfaces/webview/render-model";
import { KIND_COLORS } from "@/lib/graph-data";
import type { RenderMode } from "./graph-surface";
import { NodeSourceViewer } from "./node-source-viewer";
import { DetailPanel } from "./detail-panel";
import { CommandPalette } from "./command-palette";
import { DiagramsDrawer } from "./diagrams-drawer";
import { DocsDrawer } from "./docs-drawer";
import { AskPanel } from "./ask-panel";
import type { AskFocus } from "@core/assist/ask";

// Sigma evaluates WebGL globals (WebGL2RenderingContext) at module load, which
// don't exist during static prerender (output:export). Load both surfaces
// client-only so neither enters the server module graph.
const GraphCanvas = dynamic(() => import("./graph-canvas").then((m) => m.GraphCanvas), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-xs text-zinc-600">Rendering graph…</div>,
});
const GraphCanvas3D = dynamic(() => import("./graph-canvas-3d").then((m) => m.GraphCanvas3D), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-xs text-zinc-600">Rendering graph…</div>,
});

// Every per-browser layout key the workspace owns — cleared by "Reset layout".
const LAYOUT_KEYS = [
  "codegraph:dock:detail",
  "codegraph:dock:source",
  "codegraph:dock:diagrams",
  "codegraph:dock:docs",
  "codegraph:panel:detail",
];

const PROJECTIONS: { id: ProjectionKind; label: string; hint: string }[] = [
  { id: "full", label: "Full", hint: "Every node and edge" },
  { id: "dependency", label: "Depends", hint: "Module dependency edges" },
  { id: "call", label: "Calls", hint: "Function/method call edges" },
  { id: "structure", label: "Structure", hint: "Containment hierarchy" },
];

interface ExplorerProps {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Agent-authored knowledge diagrams (FR-28) carried on the snapshot, if any. */
  readonly diagrams?: readonly Diagram[];
  /** Agent-authored knowledge docs (FR-29) carried on the snapshot, if any. */
  readonly docs?: readonly Doc[];
  /** Agent-authored knowledge overlays (FR-37) carried on the snapshot, if any —
   * notes, markers, and groups the connected agent pinned onto the graph. */
  readonly overlays?: readonly Overlay[];
  /** Show the AI-assist "Ask" affordance (FR-30). Local-plane only — withheld on
   * the source-blind cloud demo where the user has no connected agent. */
  readonly assistEnabled?: boolean;
  readonly title: string;
  /**
   * Base URL of the source sidecar for the node code viewer (FR-15), or `null`
   * when this dataset/host serves no source (third-party graph, hosted plane — AD-16).
   */
  readonly sourceBase?: string | null;
  /**
   * Absolute repo root on the host, enabling "open in editor" deep links (FR-32)
   * from the source viewer. Set only inside the VS Code webview; `null` on the
   * web/cloud, where there's no local checkout to open (AD-14).
   */
  readonly editorRoot?: string | null;
  /** Optional dataset switcher — when present, renders a selector in the header. */
  readonly datasets?: readonly { readonly id: string; readonly label: string }[];
  readonly datasetId?: string;
  readonly onDataset?: (id: string) => void;
}

export function Explorer({
  nodes,
  edges,
  diagrams,
  docs,
  overlays,
  assistEnabled = false,
  title,
  sourceBase = null,
  editorRoot = null,
  datasets,
  datasetId,
  onDataset,
}: ExplorerProps): React.JSX.Element {
  const [projection, setProjection] = useState<ProjectionKind>("full");
  const [renderMode, setRenderMode] = useState<RenderMode>("2d");
  const [folderClustered, setFolderClustered] = useState(false);
  const [orphanMode, setOrphanMode] = useState(false);
  const [traceArmed, setTraceArmed] = useState(false);
  const [orphanCount, setOrphanCount] = useState(0);
  const [traceStatus, setTraceStatus] = useState<{ text: string; tone?: "ok" | "none" }>({ text: "" });
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  // Bumped by "Reset layout" — used as a remount key so every dock re-reads its
  // (now-cleared) localStorage and returns to defaults.
  const [layoutVersion, setLayoutVersion] = useState(0);
  const focusRef = useRef<((address: string) => void) | null>(null);
  const diagramList = diagrams ?? [];
  const docList = docs ?? [];

  // Selecting a node (canvas click or a neighbor jump, which both route through
  // onSelectNode) closes any open source view — it re-opens on demand for the
  // new node. Done in the handler, not an effect, to avoid a cascading render.
  const selectNode = useCallback((address: string) => {
    setSelected(address);
    setSourceOpen(false);
  }, []);

  // Clearing selection (empty-canvas click) also closes any open source dock.
  const clearSelection = useCallback(() => {
    setSelected(null);
    setSourceOpen(false);
  }, []);

  // Palette/jump: select first (so the detail panel opens even for a node the
  // active projection has filtered out), then pan the camera when it's on screen.
  const jumpTo = useCallback(
    (address: string) => {
      selectNode(address);
      focusRef.current?.(address);
    },
    [selectNode],
  );

  // Stable closer so the palette's effects don't re-run each render.
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Reset every dock/panel to its default size, position, and expanded state in
  // one action (FR-34). Layout is purely a localStorage preference, so we clear
  // the keys and remount the docks (via layoutVersion) to re-read the defaults —
  // no source is touched (FR-9), so no confirmation is needed.
  const resetLayout = useCallback(() => {
    if (typeof window !== "undefined") {
      for (const k of LAYOUT_KEYS) {
        try {
          window.localStorage.removeItem(k);
        } catch {
          // Private mode / quota — ignore; the remount below still resets state.
        }
      }
    }
    setLayoutVersion((v) => v + 1);
  }, []);

  // Global ⌘K / Ctrl+K toggles the palette. The listener owns the toggle so the
  // palette can mount only while open (fresh state, no reset effect). setState in
  // the callback is fine — it's the synchronous-setState-in-effect-body that the
  // React Compiler lint forbids, not an event handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const byAddress = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.address, n);
    return m;
  }, [nodes]);

  const detail = useMemo(() => {
    if (!selected) return null;
    const node = byAddress.get(selected);
    if (!node) return null;
    const callees = edges.filter((e) => e.from === selected);
    const callers = edges.filter((e) => e.to === selected);
    return { node, callees, callers };
  }, [selected, byAddress, edges]);

  // The agent's overlays (FR-37) wrapped as a set so the core query helper can
  // pick out the selected node's note, markers, and the groups it belongs to.
  const overlaySet = useMemo(
    () => ({ version: OVERLAY_SET_VERSION, overlays: overlays ?? [] }),
    [overlays],
  );
  const selectedOverlays = useMemo(
    () => (detail ? nodeOverlays(overlaySet, detail.node.address) : undefined),
    [detail, overlaySet],
  );
  // The agent's canvas-level highlights (FR-37): the dominant mark per node and
  // the grouped-address set, resolved once in the core. markedNodes maps each
  // marked address to its canvas colour so the 2D surface can tint the node
  // itself — the agent pointing at the graph, not just the detail panel.
  const overlayHl = useMemo(() => overlayHighlights(overlaySet), [overlaySet]);
  const markedNodes = useMemo(() => {
    const m = new Map<string, string>();
    for (const [address, mark] of overlayHl.marks) m.set(address, MARK_CANVAS_COLOR[mark.mark]);
    return m;
  }, [overlayHl]);

  // Context handed to the AI-assist panel (FR-30): the selected node and its
  // first-degree neighbours, so the generated prompt anchors the agent's search.
  const askFocus = useMemo<AskFocus | null>(
    () => (detail ? { address: detail.node.address, name: detail.node.name, kind: detail.node.kind } : null),
    [detail],
  );
  const askNeighbours = useMemo(() => {
    if (!detail) return [] as string[];
    const set = new Set<string>();
    for (const e of detail.callees) if (e.to !== detail.node.address) set.add(e.to);
    for (const e of detail.callers) if (e.from !== detail.node.address) set.add(e.from);
    return [...set];
  }, [detail]);

  // A legible label for an address — module paths shorten to a basename (FR-16);
  // the full path stays visible in the detail panel.
  const labelFor = (address: string): string => {
    const n = byAddress.get(address);
    return n ? displayLabel(n.name, n.kind) : address;
  };

  return (
    <main className="relative flex h-screen flex-col bg-[#0e0f13] font-sans text-zinc-200">
      <header className="z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 bg-[#0e0f13]/90 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block size-3 rounded-[3px] bg-gradient-to-br from-violet-400 to-cyan-400"
          />
          <span className="font-display text-sm font-semibold tracking-tight text-zinc-50">
            codegraph
          </span>
          <span className="hidden text-xs text-zinc-500 sm:inline">{title}</span>
        </div>

        {datasets && datasets.length > 1 && onDataset && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="sr-only">Dataset</span>
            <select
              value={datasetId}
              onChange={(e) => onDataset(e.target.value)}
              aria-label="Dataset"
              className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-xs font-medium text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id} className="bg-zinc-900">
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>
            <span className="font-mono text-zinc-300">{nodes.length.toLocaleString()}</span> nodes
          </span>
          <span>
            <span className="font-mono text-zinc-300">{edges.length.toLocaleString()}</span> edges
          </span>
        </div>

        {/* Projection segmented control (FR-4) */}
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5" role="tablist" aria-label="Projection">
          {PROJECTIONS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={projection === p.id}
              title={p.hint}
              onClick={() => setProjection(p.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                projection === p.id
                  ? "bg-zinc-700/80 text-zinc-50"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 2D ⇄ 3D render-mode toggle (FR-17) — same graph, swappable surface */}
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5" role="group" aria-label="Render mode">
          {(["2d", "3d"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={renderMode === m}
              title={m === "3d" ? "Rotatable 3D layout (drag to orbit, scroll to zoom)" : "2D graph"}
              onClick={() => setRenderMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium uppercase transition-colors ${
                renderMode === m
                  ? "bg-zinc-700/80 text-zinc-50"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Folder clustering (FR-26) — gather nodes into per-folder regions; 2D only */}
        <button
          aria-pressed={folderClustered}
          disabled={renderMode === "3d"}
          title="Gather nodes into per-folder regions"
          onClick={() => setFolderClustered((v) => !v)}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            folderClustered
              ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Folders
        </button>

        {/* Orphan overlay (FR-12) — 2D only for now */}
        <button
          aria-pressed={orphanMode}
          disabled={orphanCount === 0 || renderMode === "3d"}
          onClick={() => setOrphanMode((v) => !v)}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            orphanMode
              ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Orphans <span className="font-mono">{orphanCount}</span>
        </button>

        {/* Trace path (PM-backlog #3) — 2D only for now */}
        <button
          aria-pressed={traceArmed}
          disabled={renderMode === "3d"}
          onClick={() => setTraceArmed((v) => !v)}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            traceArmed
              ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Trace
        </button>

        {/* Knowledge diagrams drawer (FR-28) — agent-authored Mermaid narratives */}
        <button
          aria-pressed={diagramsOpen}
          aria-haspopup="dialog"
          title="Agent-authored knowledge diagrams"
          onClick={() => {
            setDocsOpen(false);
            setDiagramsOpen((v) => !v);
          }}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
            diagramsOpen
              ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Diagrams <span className="font-mono">{diagramList.length}</span>
        </button>

        {/* Knowledge docs drawer (FR-29) — agent-authored Markdown prose */}
        <button
          aria-pressed={docsOpen}
          aria-haspopup="dialog"
          title="Agent-authored documentation"
          onClick={() => {
            setDiagramsOpen(false);
            setDocsOpen((v) => !v);
          }}
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
            docsOpen
              ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Docs <span className="font-mono">{docList.length}</span>
        </button>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {/* AI-assist "Ask" (FR-30) — local-plane only (withheld on cloud) */}
          {assistEnabled && (
            <button
              onClick={() => setAskOpen(true)}
              aria-haspopup="dialog"
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 font-medium text-violet-200 transition-colors hover:bg-violet-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <span aria-hidden>✦</span> Ask
            </button>
          )}
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Search nodes"
            aria-keyshortcuts="Meta+K Control+K"
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <span aria-hidden>Search</span>
            <kbd className="rounded border border-zinc-700 bg-zinc-800/80 px-1 font-mono text-[10px] text-zinc-400">⌘K</kbd>
          </button>
          {/* Reset layout (FR-34) — clears every dock/panel size + position back to
              defaults. Layout-only (FR-9: no source touched), so no confirmation. */}
          <button
            onClick={resetLayout}
            aria-label="Reset layout"
            title="Reset all panels to their default size and position"
            className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-1.5 text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <ResetIcon />
          </button>
          {traceArmed && (
            <span
              aria-live="polite"
              className={`font-mono ${
                traceStatus.tone === "none" ? "text-zinc-500" : "text-violet-300"
              }`}
            >
              {traceStatus.text || "Click a node to start the trace"}
            </span>
          )}
          {hovered && !traceArmed && (
            <span className="font-mono text-zinc-500">{labelFor(hovered)}</span>
          )}
        </div>
      </header>

      <div className="relative flex-1">
        {/* One contract, swappable surface (AD-15): the 2D Sigma canvas or the 3D
            canvas, both fed the same projected graph + interaction callbacks. */}
        {(() => {
          const Surface = renderMode === "3d" ? GraphCanvas3D : GraphCanvas;
          return (
            <Surface
              nodes={nodes}
              edges={edges}
              projection={projection}
              selected={selected}
              folderClustered={folderClustered}
              orphanMode={orphanMode}
              traceArmed={traceArmed}
              onHoverNode={setHovered}
              onSelectNode={selectNode}
              onClearSelection={clearSelection}
              onOrphanCount={setOrphanCount}
              onTraceStatus={(text, tone) => setTraceStatus({ text, tone })}
              focusRef={focusRef}
              markedNodes={markedNodes}
              groupedNodes={overlayHl.grouped}
            />
          );
        })()}

        {/* Kind legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5 text-xs backdrop-blur">
          {Object.entries(KIND_COLORS).map(([kind, color]) => (
            <div key={kind} className="flex items-center gap-2 text-zinc-400">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color }} />
              {kind}
            </div>
          ))}
        </div>

        {/* Node detail inspector (FR-15 content, FR-34 workspace frame) — docks
            right (collapsible + resizable) or floats as a draggable card; hidden
            while the source viewer is docked. Keyed on layoutVersion so Reset
            Layout remounts it to defaults. */}
        {detail && !sourceOpen && (
          <DetailPanel
            key={layoutVersion}
            detail={detail}
            byAddress={byAddress}
            overlays={selectedOverlays}
            onClose={() => setSelected(null)}
            onViewSource={() => setSourceOpen(true)}
            onJump={(a) => focusRef.current?.(a)}
          />
        )}

        {/* ⌘K command palette (Story 8.4) — fuzzy jump-to-node */}
        {paletteOpen && (
          <CommandPalette nodes={nodes} onClose={closePalette} onSelect={jumpTo} />
        )}

        {/* Knowledge diagrams drawer (FR-28) — Related chips jump into the graph */}
        {diagramsOpen && (
          <DiagramsDrawer
            key={layoutVersion}
            diagrams={diagramList}
            byAddress={byAddress}
            onJump={jumpTo}
            onClose={() => setDiagramsOpen(false)}
          />
        )}

        {/* Knowledge docs drawer (FR-29) — sanitized Markdown + node deep-links */}
        {docsOpen && (
          <DocsDrawer
            key={layoutVersion}
            docs={docList}
            byAddress={byAddress}
            onJump={jumpTo}
            onClose={() => setDocsOpen(false)}
          />
        )}

        {/* AI-assist "Ask" panel (FR-30) — builds a prompt for the user's agent */}
        {assistEnabled && askOpen && (
          <AskPanel
            focus={askFocus}
            neighbours={askNeighbours}
            root={title}
            onClose={() => setAskOpen(false)}
          />
        )}

        {/* Read-only source dock (FR-15) — replaces the detail panel while open */}
        {detail && sourceOpen && (
          <NodeSourceViewer
            key={`${layoutVersion}:${sourceBase ?? "none"}:${detail.node.location.file}:${detail.node.location.line}`}
            sourceBase={sourceBase}
            editorRoot={editorRoot}
            file={detail.node.location.file}
            line={detail.node.location.line}
            character={detail.node.location.character}
            title={displayLabel(detail.node.name, detail.node.kind)}
            signature={detail.node.signature}
            onClose={() => setSourceOpen(false)}
          />
        )}
      </div>
    </main>
  );
}

// A counter-clockwise reset arrow — the "restore defaults" affordance for layout.
function ResetIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
