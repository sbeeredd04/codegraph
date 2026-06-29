"use client";

// Explorer shell — the interactive product surface. Owns the view state
// (projection, orphan overlay, trace arming, selection) and composes the
// GraphCanvas with a neutral toolbar + node-detail panel. Styling is
// deliberately neutral/dark here; the branded interface is layered on once the
// Better Design system is wired (held per the user's "claim the account first"
// choice). All graph logic lives in the canvas / pure core — this is glue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { ProjectionKind } from "@core/graph/projection";
import type { GraphNode, GraphEdge } from "@core/graph/types";
import type { Diagram } from "@core/diagrams/diagram";
import type { Doc } from "@core/docs/doc";
import type { Overlay } from "@core/overlays/overlay";
import { displayLabel } from "@adapters/surfaces/webview/render-model";
import type { FolderSort } from "@adapters/surfaces/webview/folder-layout";
import { partitionByPackage } from "@core/graph/package";
import { KIND_COLORS } from "@/lib/graph-data";
import type { RenderMode } from "./graph-surface";
import type { SurfaceController } from "@/lib/surface-controller";
import { findPathInEdges } from "@core/graph/path";
import { EMPTY_TRACE, extendTrace, undoTrace, type TraceState } from "@core/graph/trace";
import type { PresentationCommand } from "@core/presentation/command";
import { subscribeToPresentationCommands } from "@/lib/webview-bridge";
import { PresentingBanner } from "./presenting-banner";
import { NodeSourceViewer } from "./node-source-viewer";
import { DetailPanel } from "./detail-panel";
import { CommandPalette } from "./command-palette";
import { ActionPalette } from "./action-palette";
import { CommandCenter } from "./command-center";
import { SettingsPanel } from "./settings-panel";
import { useLauncherShortcuts } from "@/lib/use-launcher-shortcuts";
import { useExplorerSettings } from "@/lib/use-explorer-settings";
import { useAgentOverlays } from "@/lib/use-agent-overlays";
import { buildExplorerActions } from "@/lib/explorer-actions";
import { DiagramsDrawer } from "./diagrams-drawer";
import { DocsDrawer } from "./docs-drawer";
import { OnboardingPanel } from "./onboarding-panel";
import { AskPanel } from "./ask-panel";
import { TracePanel } from "./trace-panel";
import { ExplorerToolbar } from "./explorer-toolbar";
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
  "codegraph:panel:onboard",
  "codegraph:panel:trace",
  "codegraph:panel:diagrams",
  "codegraph:panel:docs",
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
  /**
   * Destination for the "Home" toolbar link back to the FR-35 landing page
   * (FR-66), or null on the VS Code webview where there's no marketing page to
   * return to (AD-14). Set by the host page.
   */
  readonly landingHref?: string | null;
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
  landingHref = null,
  datasets,
  datasetId,
  onDataset,
}: ExplorerProps): React.JSX.Element {
  const [projection, setProjection] = useState<ProjectionKind>("full");
  const [renderMode, setRenderMode] = useState<RenderMode>("2d");
  const [folderClustered, setFolderClustered] = useState(false);
  const [folderSort, setFolderSort] = useState<FolderSort>("path");
  const [orphanMode, setOrphanMode] = useState(false);
  const [traceArmed, setTraceArmed] = useState(false);
  const [orphanCount, setOrphanCount] = useState(0);
  const [traceStatus, setTraceStatus] = useState<{ text: string; tone?: "ok" | "none" }>({ text: "" });
  // FR-61: the manual execution trace — an ordered node sequence (pure core model)
  // the user assembles by clicking. A ref mirrors it so the click/undo/clear
  // handlers read the current value without re-subscribing the surfaces.
  const [trace, setTrace] = useState<TraceState>(EMPTY_TRACE);
  const traceRef = useRef<TraceState>(EMPTY_TRACE);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [centerOpen, setCenterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  // FR-57: the monorepo package the board is focused on, or null for "all".
  const [activePackage, setActivePackage] = useState<string | null>(null);
  // Bumped by "Reset layout" — used as a remount key so every dock re-reads its
  // (now-cleared) localStorage and returns to defaults.
  const [layoutVersion, setLayoutVersion] = useState(0);
  // FR-39: a short description of what the agent is currently driving, or null
  // when the human holds the wheel. Drives the user-sovereignty preempt banner.
  const [presenting, setPresenting] = useState<string | null>(null);
  const controllerRef = useRef<SurfaceController | null>(null);
  const router = useRouter();
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
      controllerRef.current?.focus([address]);
    },
    [selectNode],
  );

  // Stable closers so the palettes' effects don't re-run each render.
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeActions = useCallback(() => setActionsOpen(false), []);
  const closeCenter = useCallback(() => setCenterOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  // FR-51: persisted prefs (default surface/projection/clustering) — seed the
  // board on load, apply each change live + persisted.
  const { settings, changeSetting, resetSettings } = useExplorerSettings({ setRenderMode, setProjection, setFolderClustered });
  // Read the live surface controller only when an action runs (never in render).
  const getController = useCallback(() => controllerRef.current, []);

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

  // FR-39: take back the wheel — clear the agent's transient highlight and hide
  // the preempt banner. An explicit dismissal returns the surface to the human.
  const takeControl = useCallback(() => {
    controllerRef.current?.highlight([]);
    setPresenting(null);
  }, []);

  // FR-39: apply one inbound presentation command from the agent. Highlight/camera
  // directives route through the FR-43 surface controller; panel/projection/lens
  // directives flip explorer view state. Every command raises the preempt banner
  // so the human always knows — and can reclaim — control. Read-only (FR-9): a
  // command only ever changes the VIEW, never the user's source.
  const dispatchCommand = useCallback(
    (cmd: PresentationCommand) => {
      const c = controllerRef.current;
      let label = "presenting";
      switch (cmd.kind) {
        case "highlight_nodes":
          c?.highlight(cmd.addresses, cmd.style);
          label = `highlighting ${cmd.addresses.length} node${cmd.addresses.length === 1 ? "" : "s"}`;
          break;
        case "highlight_path": {
          const path = findPathInEdges(nodes, edges, cmd.from, cmd.to);
          if (path?.found && path.nodes.length) {
            c?.highlight(path.nodes, "trace");
            label = `tracing a ${path.nodes.length}-node path`;
          } else {
            label = "no path between those nodes";
          }
          break;
        }
        case "focus_camera":
          if (cmd.select === false) c?.frame(cmd.addresses);
          else c?.focus(cmd.addresses);
          label = "moving the camera";
          break;
        case "set_projection":
          setProjection(cmd.projection);
          label = `projection → ${cmd.projection}`;
          break;
        case "open_panel": {
          const open = cmd.open !== false;
          if (cmd.panel === "diagrams") {
            setDocsOpen(false);
            setDiagramsOpen(open);
          } else if (cmd.panel === "docs") {
            setDiagramsOpen(false);
            setDocsOpen(open);
          } else if (cmd.panel === "ask") {
            setAskOpen(open);
          } else if (cmd.panel === "detail" && !open) {
            setSelected(null);
          }
          label = `${open ? "opening" : "closing"} the ${cmd.panel} panel`;
          break;
        }
        case "toggle_affordance": {
          const setOn =
            cmd.affordance === "orphans"
              ? setOrphanMode
              : cmd.affordance === "folders"
                ? setFolderClustered
                : setTraceArmed;
          if (typeof cmd.on === "boolean") setOn(cmd.on);
          else setOn((v) => !v);
          label = `${cmd.affordance} lens`;
          break;
        }
        case "replay":
          // FR-40 guided tour: the controller walks the stops over time; the banner
          // stays up for the whole tour so the human can reclaim the wheel at any
          // step (Take control → highlight([]) cancels the in-flight timers).
          c?.replay(cmd.addresses, cmd.dwellMs !== undefined ? { dwellMs: cmd.dwellMs } : undefined);
          label = `replaying a ${cmd.addresses.length}-stop tour`;
          break;
      }
      setPresenting(label);
    },
    [nodes, edges],
  );

  // FR-39: subscribe to the host's live presentation commands (the agent driving
  // the board). The bridge validates each through the shared core codec; off the
  // webview the handler never fires. Re-subscribes when the graph changes so a
  // path-trace resolves against the current edges.
  useEffect(() => subscribeToPresentationCommands(dispatchCommand), [dispatchCommand]);

  // ⌘Space command center (FR-49) · ⌘⇧P actions (FR-50) · ⌘K node search — one
  // listener, mutually exclusive so the launcher modals never stack.
  useLauncherShortcuts({ setSearch: setPaletteOpen, setActions: setActionsOpen, setCenter: setCenterOpen });

  const byAddress = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.address, n);
    return m;
  }, [nodes]);

  // FR-57: partition the graph into monorepo packages from path metadata already
  // on the nodes (structural, cloud-safe). Recomputed only when the node set
  // changes; the toolbar renders a filter only when there are ≥2 packages.
  const partition = useMemo(() => partitionByPackage(nodes), [nodes]);

  // Focus the board on one package: highlight + frame its nodes through the same
  // FR-43 surface controller the agent drives, or clear back to the whole graph.
  // Read-only (FR-9): only the view changes. If a stale selection leaves the
  // package empty, treat it as "all".
  const onPackage = useCallback(
    (id: string | null) => {
      const c = controllerRef.current;
      if (!id) {
        c?.highlight([]);
        setActivePackage(null);
        return;
      }
      const members: string[] = [];
      for (const [address, pkg] of partition.of) if (pkg === id) members.push(address);
      setActivePackage(members.length ? id : null);
      if (!members.length) {
        c?.highlight([]);
        return;
      }
      c?.highlight(members, "accent");
      c?.frame(members);
    },
    [partition],
  );

  const detail = useMemo(() => {
    if (!selected) return null;
    const node = byAddress.get(selected);
    if (!node) return null;
    const callees = edges.filter((e) => e.from === selected);
    const callers = edges.filter((e) => e.to === selected);
    return { node, callees, callers };
  }, [selected, byAddress, edges]);

  // FR-57: the human label of the selected node's package, for the detail chip.
  const selectedPackageLabel = useMemo(() => {
    if (!detail) return null;
    const id = partition.of.get(detail.node.address);
    if (!id) return null;
    return partition.packages.find((p) => p.id === id)?.label ?? id;
  }, [detail, partition]);

  // FR-37/FR-42: the agent's overlays (the selected node's note/markers/groups +
  // the per-node canvas tints + the grouped-address set) and the onboarding
  // playbook — all derived from the live snapshot through the pure core helpers.
  const { selectedOverlays, markedNodes, grouped, playbook, coverage } = useAgentOverlays({
    nodes,
    edges,
    diagrams,
    docs,
    overlays,
    detail,
  });

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
  const labelFor = useCallback(
    (address: string): string => {
      const n = byAddress.get(address);
      return n ? displayLabel(n.name, n.kind) : address;
    },
    [byAddress],
  );

  // FR-61: commit a new trace state — keep the ref + the render state + every
  // surface's declarative `traceSteps` in sync from one place.
  const applyTrace = useCallback((next: TraceState) => {
    traceRef.current = next;
    setTrace(next);
  }, []);

  // FR-61: a click while tracing extends the manual trace. The pure-core
  // `extendTrace` splices in the shortest directed path to a reachable target (so
  // every hop is edge-validated) or records a disjoint jump otherwise; the status
  // line narrates the last hop. View-only (FR-9) — never touches source.
  const onTraceClick = useCallback(
    (address: string) => {
      const prev = traceRef.current;
      const next = extendTrace(prev, nodes, edges, address);
      if (next === prev) {
        setTraceStatus({ text: `${labelFor(address)} is already the trace tail` });
        return;
      }
      applyTrace(next);
      if (prev.steps.length === 0) {
        setTraceStatus({ text: `Trace started — ${labelFor(address)}` });
        return;
      }
      const tail = prev.steps[prev.steps.length - 1];
      const path = findPathInEdges(nodes, edges, tail, address);
      if (path?.found) {
        const hops = path.length === 1 ? "1 hop" : `${path.length} hops`;
        setTraceStatus({
          text: `${labelFor(tail)} → ${labelFor(address)} · ${hops} · ${next.steps.length} nodes`,
          tone: "ok",
        });
      } else {
        setTraceStatus({
          text: `${labelFor(address)} added — no path from ${labelFor(tail)}`,
          tone: "none",
        });
      }
    },
    [nodes, edges, labelFor, applyTrace],
  );

  // FR-61 trace panel actions: undo one hop, clear the whole trace, or play it
  // back as a cinematic camera walk (reuses the FR-40/FR-48 replay machinery, so
  // the 3D camera flies node-to-node along the route).
  const undoTraceStep = useCallback(() => {
    const next = undoTrace(traceRef.current);
    applyTrace(next);
    setTraceStatus(next.steps.length ? { text: `${next.steps.length} nodes traced` } : { text: "" });
  }, [applyTrace]);
  const clearTraceAll = useCallback(() => {
    applyTrace(EMPTY_TRACE);
    setTraceStatus({ text: "" });
  }, [applyTrace]);
  const playTrace = useCallback(() => {
    if (traceRef.current.steps.length > 1) controllerRef.current?.replay(traceRef.current.steps);
  }, []);

  // FR-61: the trail the surfaces paint — the live trace while armed, empty while
  // disarmed (so toggling off hides it without discarding the route, and re-arming
  // resumes it). `EMPTY_TRACE.steps` is a stable [] so the surfaces' light effect
  // doesn't re-fire every render. The "Clear" panel action empties it explicitly.
  const traceSteps = traceArmed ? trace.steps : EMPTY_TRACE.steps;

  // FR-50: the ⌘⇧P action catalogue — the SAME setters/handlers the toolbar uses
  // (single source of truth). Built lazily on open, so no ref read during render.
  const buildActions = () =>
    buildExplorerActions({
      renderMode, projection, folderClustered, orphanMode, orphanCount, traceArmed,
      diagramsOpen, docsOpen, onboardOpen, hasSelection: selected != null, assistEnabled,
      setRenderMode, setProjection, setFolderClustered, setOrphanMode, setTraceArmed,
      setDiagramsOpen, setDocsOpen, setOnboardOpen, setAskOpen, setPaletteOpen, setSettingsOpen,
      resetLayout,
      navigateGuide: () => router.push("/docs"),
      controller: getController,
    });

  return (
    <main className="relative flex h-screen flex-col bg-[#0e0f13] font-sans text-zinc-200">
      <ExplorerToolbar
        title={title}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        datasets={datasets}
        datasetId={datasetId}
        onDataset={onDataset}
        projection={projection}
        onProjection={setProjection}
        renderMode={renderMode}
        onRenderMode={setRenderMode}
        folderClustered={folderClustered}
        onToggleFolders={() => setFolderClustered((v) => !v)}
        folderSort={folderSort}
        onFolderSort={setFolderSort}
        packages={partition.packages}
        activePackage={activePackage}
        onPackage={onPackage}
        orphanMode={orphanMode}
        orphanCount={orphanCount}
        onToggleOrphans={() => setOrphanMode((v) => !v)}
        traceArmed={traceArmed}
        onToggleTrace={() => setTraceArmed((v) => !v)}
        diagramsOpen={diagramsOpen}
        diagramCount={diagramList.length}
        onToggleDiagrams={() => {
          setDocsOpen(false);
          setDiagramsOpen((v) => !v);
        }}
        docsOpen={docsOpen}
        docCount={docList.length}
        onToggleDocs={() => {
          setDiagramsOpen(false);
          setDocsOpen((v) => !v);
        }}
        onboardOpen={onboardOpen}
        onToggleOnboard={() => setOnboardOpen((v) => !v)}
        onboardDone={playbook.done}
        onboardTotal={playbook.total}
        onboardComplete={playbook.complete}
        landingHref={landingHref}
        assistEnabled={assistEnabled}
        onAsk={() => setAskOpen(true)}
        onSearch={() => setPaletteOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onResetLayout={resetLayout}
        traceStatus={traceStatus}
        hoveredLabel={hovered ? labelFor(hovered) : null}
      />

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
              folderSort={folderSort}
              orphanMode={orphanMode}
              traceArmed={traceArmed}
              traceSteps={traceSteps}
              onHoverNode={setHovered}
              onSelectNode={selectNode}
              onTraceClick={onTraceClick}
              onClearSelection={clearSelection}
              onOrphanCount={setOrphanCount}
              controllerRef={controllerRef}
              markedNodes={markedNodes}
              groupedNodes={grouped}
            />
          );
        })()}

        {/* FR-39: user-sovereignty preempt banner — shown while the agent drives. */}
        {presenting !== null && <PresentingBanner action={presenting} onDismiss={takeControl} />}

        {/* FR-42: agent onboarding progress — chrome, not a graph lens, so it shows
            identically over the 2D and 3D surfaces. Dismissible + non-blocking. */}
        {onboardOpen && (
          <OnboardingPanel playbook={playbook} coverage={coverage} onDismiss={() => setOnboardOpen(false)} />
        )}

        {/* FR-61: manual execution trace — lists the ordered route the user is
            assembling by clicking nodes, with undo / clear / cinematic playback.
            Chrome over both surfaces (the trail itself is painted by the canvas). */}
        {traceArmed && (
          <TracePanel
            steps={trace.steps}
            labelFor={labelFor}
            onJump={jumpTo}
            onUndo={undoTraceStep}
            onClear={clearTraceAll}
            onPlay={playTrace}
            onClose={() => setTraceArmed(false)}
          />
        )}

        {/* Kind legend — bottom-left chrome over both surfaces (FR-53: the dev-only
            Next route badge that used to sit here is hidden via next.config). */}
        <div
          role="img"
          aria-label="Legend: node colours by kind"
          className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5 text-xs backdrop-blur"
        >
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
            edges={edges}
            overlays={selectedOverlays}
            packageLabel={selectedPackageLabel}
            onClose={() => setSelected(null)}
            onViewSource={() => setSourceOpen(true)}
            onJump={(a) => controllerRef.current?.focus([a])}
          />
        )}

        {/* ⌘K command palette (Story 8.4) — fuzzy jump-to-node */}
        {paletteOpen && (
          <CommandPalette nodes={nodes} onClose={closePalette} onSelect={jumpTo} />
        )}

        {/* ⌘⇧P action palette (FR-50) — fuzzy run-an-action, distinct from ⌘K */}
        {actionsOpen && <ActionPalette build={buildActions} onClose={closeActions} />}

        {/* ⌘Space command center (FR-49) — unified node + action launcher */}
        {centerOpen && (
          <CommandCenter nodes={nodes} buildActions={buildActions} onSelectNode={jumpTo} onClose={closeCenter} />
        )}

        {/* Settings (FR-51) — persisted board preferences, applied live */}
        {settingsOpen && (
          <SettingsPanel
            settings={settings}
            onChange={changeSetting}
            onReset={resetSettings}
            onClose={closeSettings}
          />
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
