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
import { displayLabel } from "@adapters/surfaces/webview/render-model";
import { KIND_COLORS } from "@/lib/graph-data";
import type { RenderMode } from "./graph-surface";
import { NodeSourceViewer } from "./node-source-viewer";
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

        {/* Node detail panel — hidden while the source viewer is docked */}
        {detail && !sourceOpen && (
          <aside className="absolute right-3 top-3 max-h-[calc(100%-1.5rem)] w-72 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/95 p-4 text-sm shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-zinc-50" title={detail.node.name}>
                  {displayLabel(detail.node.name, detail.node.kind)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: KIND_COLORS[detail.node.kind] ?? "#8b93a7" }}
                  />
                  {detail.node.kind}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close detail"
                className="-mr-1 -mt-1 rounded p-1 text-zinc-500 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 break-all font-mono text-xs text-zinc-400">
              {detail.node.location.file}:{detail.node.location.line}
            </div>

            {/* View source (FR-15) — opens the read-only code dock */}
            <button
              onClick={() => setSourceOpen(true)}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <span aria-hidden>{"</>"}</span> View source
            </button>

            {detail.node.signature && (
              <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-950/60 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
                {detail.node.signature}
              </pre>
            )}

            <NeighborList label="Calls / depends on" edges={detail.callees} dir="to" onJump={(a) => focusRef.current?.(a)} byAddress={byAddress} />
            <NeighborList label="Called / depended on by" edges={detail.callers} dir="from" onJump={(a) => focusRef.current?.(a)} byAddress={byAddress} />
          </aside>
        )}

        {/* ⌘K command palette (Story 8.4) — fuzzy jump-to-node */}
        {paletteOpen && (
          <CommandPalette nodes={nodes} onClose={closePalette} onSelect={jumpTo} />
        )}

        {/* Knowledge diagrams drawer (FR-28) — Related chips jump into the graph */}
        {diagramsOpen && (
          <DiagramsDrawer
            diagrams={diagramList}
            byAddress={byAddress}
            onJump={jumpTo}
            onClose={() => setDiagramsOpen(false)}
          />
        )}

        {/* Knowledge docs drawer (FR-29) — sanitized Markdown + node deep-links */}
        {docsOpen && (
          <DocsDrawer
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
            key={`${sourceBase ?? "none"}:${detail.node.location.file}:${detail.node.location.line}`}
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

function NeighborList({
  label,
  edges,
  dir,
  onJump,
  byAddress,
}: {
  label: string;
  edges: readonly GraphEdge[];
  dir: "to" | "from";
  onJump: (address: string) => void;
  byAddress: Map<string, GraphNode>;
}): React.JSX.Element | null {
  if (edges.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label} <span className="font-mono">{edges.length}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {edges.slice(0, 12).map((e) => {
          const addr = dir === "to" ? e.to : e.from;
          const n = byAddress.get(addr);
          return (
            <li key={`${e.from}->${e.to}:${e.type}`}>
              <button
                onClick={() => onJump(addr)}
                className="w-full truncate rounded px-1.5 py-1 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50"
                title={addr}
              >
                <span className="text-zinc-600">{e.type} </span>
                {n ? displayLabel(n.name, n.kind) : addr.split("::").pop()}
              </button>
            </li>
          );
        })}
        {edges.length > 12 && (
          <li className="px-1.5 pt-1 text-xs text-zinc-600">+{edges.length - 12} more</li>
        )}
      </ul>
    </div>
  );
}
