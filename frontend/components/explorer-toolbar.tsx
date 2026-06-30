"use client";

// Explorer toolbar (FR-57 extraction). The full header chrome — brand, dataset +
// package scope, node/edge counts, projection + render-mode + lens controls, the
// knowledge-drawer toggles, and the right-side action cluster — pulled out of
// explorer.tsx so the shell stays under the file-size cap and this stays a thin,
// purely-presentational surface. Every control is driven by a callback the shell
// owns (single source of truth); no view state lives here. Accessible names,
// titles, roles, and counts are preserved verbatim so the existing e2e contracts
// (which locate controls by their accessible name) keep passing.

import Link from "next/link";
import {
  Sparkles,
  BookOpen,
  Home as HomeIcon,
  Search as SearchIcon,
  Folder as FolderIcon,
  Ghost,
  Route as RouteIcon,
  Layers as LayersIcon,
  GitCompare as GitCompareIcon,
  Workflow,
  FileText,
  ListChecks,
  Package,
  Database,
  SlidersHorizontal as SettingsIcon,
} from "./icons";
import type { ProjectionKind } from "@core/graph/projection";
import type { FolderSort } from "@adapters/surfaces/webview/folder-layout";
import type { PackageInfo } from "@core/graph/package";
import type { RenderMode } from "./graph-surface";

const PROJECTIONS: { id: ProjectionKind; label: string; hint: string }[] = [
  { id: "full", label: "Full", hint: "Every node and edge" },
  { id: "dependency", label: "Depends", hint: "Module dependency edges" },
  { id: "call", label: "Calls", hint: "Function/method call edges" },
  { id: "structure", label: "Structure", hint: "Containment hierarchy" },
];

interface ExplorerToolbarProps {
  readonly title: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasets?: readonly { readonly id: string; readonly label: string }[];
  readonly datasetId?: string;
  readonly onDataset?: (id: string) => void;
  readonly projection: ProjectionKind;
  readonly onProjection: (p: ProjectionKind) => void;
  readonly renderMode: RenderMode;
  readonly onRenderMode: (m: RenderMode) => void;
  readonly folderClustered: boolean;
  readonly onToggleFolders: () => void;
  readonly folderSort: FolderSort;
  readonly onFolderSort: (s: FolderSort) => void;
  /** Monorepo packages the graph partitions into (FR-57), or fewer than 2 to hide. */
  readonly packages: readonly PackageInfo[];
  readonly activePackage: string | null;
  readonly onPackage: (id: string | null) => void;
  /** "Colour by package" (FR-57): persistently tint every node by its package as a
   * recessive backdrop, and switch the legend from kind to package. */
  readonly showPackages: boolean;
  readonly onTogglePackages: () => void;
  readonly orphanMode: boolean;
  readonly orphanCount: number;
  readonly onToggleOrphans: () => void;
  readonly traceArmed: boolean;
  readonly onToggleTrace: () => void;
  /** Layered neighbour analysis (FR-72): light the selected node's concentric BFS
   * shells, depth-coloured, with a depth control. 2D for now (3D parity in FR-72b-2). */
  readonly layersMode: boolean;
  readonly onToggleLayers: () => void;
  /** Live graph-diff lens (FR-69): pin a baseline and light what changed between it
   * and the live graph (added/removed/changed/moved), with a ranked change panel.
   * Works on both surfaces. */
  readonly diffMode: boolean;
  readonly onToggleDiff: () => void;
  readonly diagramsOpen: boolean;
  readonly diagramCount: number;
  readonly onToggleDiagrams: () => void;
  readonly docsOpen: boolean;
  readonly docCount: number;
  readonly onToggleDocs: () => void;
  readonly onboardOpen: boolean;
  readonly onToggleOnboard: () => void;
  readonly onboardDone: number;
  readonly onboardTotal: number;
  readonly onboardComplete: boolean;
  /**
   * Destination of the "Home" link back to the FR-35 landing page (FR-66), or
   * null/undefined to hide it. Withheld inside the VS Code webview, where the
   * embedded board has no marketing page to return to (AD-14).
   */
  readonly landingHref?: string | null;
  /**
   * (Re)index the workspace (FR-55 user trigger). Present only where source is
   * reachable — the VS Code webview host (and dev, for the e2e) — and withheld on
   * the source-blind cloud plane, which has no host files to scan (AD-14). When
   * set, the toolbar shows an "Index" affordance that streams live progress.
   */
  readonly onIndex?: () => void;
  /** A scan is in flight — the Index button reflects it (label + busy state). */
  readonly indexing?: boolean;
  readonly assistEnabled: boolean;
  readonly onAsk: () => void;
  readonly onSearch: () => void;
  readonly onSettings: () => void;
  readonly onResetLayout: () => void;
  readonly traceStatus: { text: string; tone?: "ok" | "none" };
  readonly hoveredLabel: string | null;
}

export function ExplorerToolbar({
  title,
  nodeCount,
  edgeCount,
  datasets,
  datasetId,
  onDataset,
  projection,
  onProjection,
  renderMode,
  onRenderMode,
  folderClustered,
  onToggleFolders,
  folderSort,
  onFolderSort,
  packages,
  activePackage,
  onPackage,
  showPackages,
  onTogglePackages,
  orphanMode,
  orphanCount,
  onToggleOrphans,
  traceArmed,
  onToggleTrace,
  layersMode,
  onToggleLayers,
  diffMode,
  onToggleDiff,
  diagramsOpen,
  diagramCount,
  onToggleDiagrams,
  docsOpen,
  docCount,
  onToggleDocs,
  onboardOpen,
  onToggleOnboard,
  onboardDone,
  onboardTotal,
  onboardComplete,
  landingHref,
  onIndex,
  indexing,
  assistEnabled,
  onAsk,
  onSearch,
  onSettings,
  onResetLayout,
  traceStatus,
  hoveredLabel,
}: ExplorerToolbarProps): React.JSX.Element {
  return (
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
          <span className="font-mono text-zinc-300">{nodeCount.toLocaleString()}</span> nodes
        </span>
        <span>
          <span className="font-mono text-zinc-300">{edgeCount.toLocaleString()}</span> edges
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
            onClick={() => onProjection(p.id)}
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
            onClick={() => onRenderMode(m)}
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

      {/* Package partition filter (FR-57) — focus the board on one monorepo package.
          Shown only for a genuinely multi-package repo. */}
      {packages.length >= 2 && (
        <label
          className="flex items-center gap-1.5 text-xs text-zinc-500"
          title="Focus the board on one package"
        >
          <span aria-hidden className="text-zinc-500">
            <Package size={14} />
          </span>
          <span className="sr-only">Package</span>
          <select
            aria-label="Package"
            value={activePackage ?? ""}
            onChange={(e) => onPackage(e.target.value || null)}
            className={`rounded-lg border bg-zinc-900/60 px-2 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              activePackage
                ? "border-violet-500/50 text-violet-200"
                : "border-zinc-800 text-zinc-300"
            }`}
          >
            <option value="" className="bg-zinc-900">
              All packages
            </option>
            {packages.map((p) => (
              <option key={p.id} value={p.id} className="bg-zinc-900">
                {p.label} · {p.count}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Colour-by-package (FR-57) — persistently tint every node by its package as
          a recessive backdrop + switch the legend to packages. Distinct from the
          filter above, which only narrows; this is an always-on cue. Multi-pkg only. */}
      {packages.length >= 2 && (
        <button
          aria-pressed={showPackages}
          title="Colour every node by its package"
          onClick={onTogglePackages}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
            showPackages
              ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Package size={14} /> Colour
        </button>
      )}

      {/* Folder clustering (FR-26) — gather nodes into per-folder regions; 2D only */}
      <button
        aria-pressed={folderClustered}
        disabled={renderMode === "3d"}
        title="Gather nodes into per-folder regions"
        onClick={onToggleFolders}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          folderClustered
            ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <FolderIcon size={14} /> Folders
      </button>

      {/* Folder sort order (FR-26 follow-up) — contextual to clustering; decides
          which folder takes the central anchor. Shown only when clustering is on. */}
      {folderClustered && renderMode !== "3d" && (
        <div
          role="group"
          aria-label="Sort folders"
          className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5"
        >
          {(
            [
              { id: "path", title: "Order folders alphabetically" },
              { id: "size", title: "Largest folders toward the centre" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              aria-pressed={folderSort === s.id}
              title={s.title}
              onClick={() => onFolderSort(s.id)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                folderSort === s.id
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s.id}
            </button>
          ))}
        </div>
      )}

      {/* Orphan overlay (FR-12) — 2D only for now */}
      <button
        aria-pressed={orphanMode}
        disabled={orphanCount === 0 || renderMode === "3d"}
        onClick={onToggleOrphans}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          orphanMode
            ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <Ghost size={14} /> Orphans <span className="font-mono">{orphanCount}</span>
      </button>

      {/* Manual execution trace (FR-61) — click nodes to build an ordered route;
          works on both the 2D and 3D surfaces. */}
      <button
        aria-pressed={traceArmed}
        title="Trace: click nodes to build an ordered route through the graph"
        onClick={onToggleTrace}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
          traceArmed
            ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <RouteIcon size={14} /> Trace
      </button>

      {/* Layered neighbour analysis (FR-72) — concentric BFS shells from the selected
          node, depth-coloured, with a depth control. Works on both surfaces (FR-72b-2
          brought the depth ramp to the 3D draw loop). */}
      <button
        aria-pressed={layersMode}
        title="Layers: light the selected node's neighbourhood layer by layer, coloured by depth"
        onClick={onToggleLayers}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          layersMode
            ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <LayersIcon size={14} /> Layers
      </button>

      {/* Live graph-diff lens (FR-69) — pin a baseline, then light what changed between
          it and the live graph (added=green / removed=red / changed=amber / moved=violet),
          with a blast-radius-ranked change panel. Works on both surfaces. */}
      <button
        aria-pressed={diffMode}
        title="Diff: pin a baseline and highlight what changed in the live graph"
        onClick={onToggleDiff}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
          diffMode
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <GitCompareIcon size={14} /> Diff
      </button>

      {/* Knowledge diagrams drawer (FR-28) — agent-authored Mermaid narratives */}
      <button
        aria-pressed={diagramsOpen}
        aria-haspopup="dialog"
        title="Agent-authored knowledge diagrams"
        onClick={onToggleDiagrams}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
          diagramsOpen
            ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <Workflow size={14} /> Diagrams <span className="font-mono">{diagramCount}</span>
      </button>

      {/* Knowledge docs drawer (FR-29) — agent-authored Markdown prose */}
      <button
        aria-pressed={docsOpen}
        aria-haspopup="dialog"
        title="Agent-authored documentation"
        onClick={onToggleDocs}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
          docsOpen
            ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <FileText size={14} /> Docs <span className="font-mono">{docCount}</span>
      </button>

      {/* Onboarding progress (FR-42) — mirrors the agent's codegraph_onboard
          checklist so the human sees how far the knowledge layer is bootstrapped.
          Emerald when the starter layer is complete, neutral while gaps remain. */}
      <button
        aria-pressed={onboardOpen}
        aria-expanded={onboardOpen}
        title="Agent onboarding progress — the starter knowledge checklist"
        onClick={onToggleOnboard}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
          onboardOpen
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
            : onboardComplete
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300/80 hover:text-emerald-200"
              : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <ListChecks size={14} /> Setup{" "}
        <span className="font-mono">
          {onboardDone}/{onboardTotal}
        </span>
      </button>

      <div className="ml-auto flex items-center gap-3 text-xs">
        {/* Index repository (FR-55) — scan the workspace and (re)build the graph,
            with live progress on the board. Present only where source is reachable
            (the webview host / dev); withheld on the source-blind cloud plane,
            which has no host files to scan (AD-14). */}
        {onIndex && (
          <button
            onClick={onIndex}
            aria-label="Index repository"
            aria-busy={indexing}
            title="Scan this workspace and rebuild the graph (live progress)"
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <Database size={14} /> {indexing ? "Indexing…" : "Index"}
          </button>
        )}
        {/* AI-assist "Ask" (FR-30) — local-plane only (withheld on cloud) */}
        {assistEnabled && (
          <button
            onClick={onAsk}
            aria-haspopup="dialog"
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 font-medium text-violet-200 transition-colors hover:bg-violet-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <Sparkles size={14} /> Ask
          </button>
        )}
        {/* Home (FR-66) — cross-surface nav back to the FR-35 landing page. A
            cloud/web-plane affordance: the host passes a href on the web, and
            withholds it (null) inside the VS Code webview, where the embedded
            board has no marketing page to return to (AD-14). Root-relative so it
            resolves under the web mount; next/link for client-side nav. */}
        {landingHref && (
          <Link
            href={landingHref}
            prefetch={false}
            title="Back to the codegraph home page"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <HomeIcon size={14} /> Home
          </Link>
        )}
        {/* Guide (FR-45) — client-side nav to the first-party guide pages
            (/docs is root-level, so the link resolves under both the web mount
            and the webview origin). Named "Guide" to stay distinct from the
            agent-authored Docs drawer toggle above. */}
        <Link
          href="/docs"
          prefetch={false}
          title="Open the codegraph guide"
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <BookOpen size={14} /> Guide
        </Link>
        <button
          onClick={onSearch}
          aria-label="Search nodes"
          aria-keyshortcuts="Meta+K Control+K"
          className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <SearchIcon size={14} />
          <span aria-hidden>Search</span>
          <kbd className="rounded border border-zinc-700 bg-zinc-800/80 px-1 font-mono text-[10px] text-zinc-400">⌘K</kbd>
        </button>
        {/* Settings (FR-51) — persisted board preferences */}
        <button
          onClick={onSettings}
          aria-label="Open settings"
          aria-haspopup="dialog"
          title="Board preferences"
          className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-1.5 text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <SettingsIcon size={15} />
        </button>
        {/* Reset layout (FR-34) — clears every dock/panel size + position back to
            defaults. Layout-only (FR-9: no source touched), so no confirmation. */}
        <button
          onClick={onResetLayout}
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
        {hoveredLabel && !traceArmed && (
          <span className="font-mono text-zinc-500">{hoveredLabel}</span>
        )}
      </div>
    </header>
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
