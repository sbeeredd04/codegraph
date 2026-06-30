"use client";

// Interactive graph canvas — the React port of the two Sigma surfaces
// (webview/graph-view.ts + web/viewer.ts). The HARD logic is reused from the
// tested pure core: projectGraph (FR-4), findOrphanAddresses (FR-12),
// buildRenderModel (positions/colours/sizes), nodeHiddenAtRatio (semantic-zoom
// LOD, FR-5) and findPathInEdges (trace, PM-backlog #3). Only the Sigma
// lifecycle + the lens reducers are rewritten here, idiomatically for React:
// the heavy rebuild (layout) keys on nodes/edges/projection, while orphan-mode
// and the traced path are read live from refs so toggling them only refreshes
// the reducers — no relayout, the camera stays put.

import { useEffect, useRef } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { projectGraph } from "@core/graph/projection";
import { pathEdgeKey, type PathHighlight } from "@core/graph/path";
import { traceHighlight } from "@core/graph/trace";
import { focusHighlight, type FocusHighlight } from "@core/graph/focus";
import { planReplay } from "@core/presentation/replay";
import type { NodeKind } from "@core/graph/types";
import {
  buildRenderModel,
  findOrphanAddresses,
} from "@adapters/surfaces/webview/render-model";
import { nodeHiddenAtRatio } from "@adapters/surfaces/webview/lod";
import {
  clusterByFolder,
  type FolderNode,
  type FolderRegion,
} from "@adapters/surfaces/webview/folder-layout";
import type { GraphSurfaceProps } from "./graph-surface";
import type { SurfaceController } from "@/lib/surface-controller";
import { resolveReducedMotion } from "@/lib/reduced-motion";
import { labelDensityProfile } from "@/lib/label-layout-3d";
import { GROUP_TINT, HIGHLIGHT_STYLE_COLOR } from "@/lib/overlay-style";
import { layerColor } from "@/lib/layer-palette";
import { DIFF_COLORS } from "@/lib/diff-palette";
import type { ChangeKind } from "@adapters/surfaces/webview/render-model";

interface XY {
  x: number;
  y: number;
}

// Recessive tones for off-focus elements, shared with the webview surfaces so
// the orphan overlay and trace lens read identically across all three.
const ORPHAN_DIM_NODE = "#39414f";
const ORPHAN_DIM_EDGE = "#262c38";
const PATH_EDGE = "#a78bfa";
const EDGE_COLOR = "#333a4d";
// The selected node pops in brand violet; its incident edges reuse PATH_EDGE so
// the focus lens (FR-25) reads identically to the trace lens.
const SELECTED_NODE = "#c4b5fd";

// The 2D surface implements the shared render-surface contract (AD-15).
export type GraphCanvasProps = GraphSurfaceProps;

const SVG_NS = "http://www.w3.org/2000/svg";

/** A closed SVG polygon path through the given screen-space points. */
function polygonPath(pts: readonly XY[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";
}

/**
 * The label shown over a folder territory. Deep paths collapse to their leaf
 * segment (with a "…/" hint) so labels stay short and don't overlap across a
 * dense map; one- or two-segment folders show in full. "(root)" for repo-root.
 */
function folderLabel(folder: string): string {
  if (folder === "") return "(root)";
  const segs = folder.split("/");
  return segs.length <= 2 ? folder : `…/${segs[segs.length - 1]}`;
}

// Declutter the territory overlay the same way FR-27 declutters node labels: a
// folder needs at least this many nodes to earn an outline, and only the largest
// regions are drawn — so a 40-folder graph reads instead of drowning in labels.
const MIN_REGION_NODES = 3;
const MAX_REGIONS = 14;

/** The largest folder regions worth outlining + labelling, biggest first. */
function topRegions(regions: readonly FolderRegion[]): FolderRegion[] {
  return [...regions]
    .filter((r) => r.count >= MIN_REGION_NODES)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_REGIONS);
}

// A small palette of muted, distinct hues so adjacent folder territories read as
// SEPARATE regions instead of one undifferentiated grey wash. The hue is chosen by
// a stable hash of the folder path, so a folder keeps its colour across pan/zoom.
const FOLDER_HUES = [
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f59e0b", // amber
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#818cf8", // indigo
  "#fbbf24", // gold
] as const;

function hashFolder(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The stable territory hue for a folder path. */
function folderHue(folder: string): string {
  return FOLDER_HUES[hashFolder(folder) % FOLDER_HUES.length];
}

/** `#rrggbb` + alpha → an `rgba(...)` string. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A fuller folder label (last `segs` path segments) for disambiguation. */
function folderLabelFull(folder: string, segs: number): string {
  if (folder === "") return "(root)";
  const parts = folder.split("/");
  return parts.length <= segs ? folder : `…/${parts.slice(-segs).join("/")}`;
}

/** Label each region, expanding any whose short leaf label collides with another's
 *  (e.g. two `…/internals`) to the MINIMAL number of trailing path segments that
 *  tells the colliding territories apart (`…/client/src/internals` vs
 *  `…/server/src/internals`) — never two regions reading as the same ambiguous name. */
function disambiguateFolderLabels(regions: readonly FolderRegion[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const r of regions) {
    const l = folderLabel(r.folder);
    const g = groups.get(l);
    if (g) g.push(r.folder);
    else groups.set(l, [r.folder]);
  }
  const out = new Map<string, string>();
  for (const [short, folders] of groups) {
    if (folders.length === 1) {
      out.set(folders[0], short);
      continue;
    }
    for (const f of folders) {
      let segs = 2;
      let label = folderLabelFull(f, segs);
      while (segs < 6 && folders.some((g) => g !== f && folderLabelFull(g, segs) === label)) {
        label = folderLabelFull(f, ++segs);
      }
      out.set(f, label);
    }
  }
  return out;
}

/** The manual trace (FR-61) as a path-highlight the reducers already understand,
 * filtered to nodes the current projection actually renders — a step the active
 * projection hides drops out (and its incident trail edge simply matches nothing),
 * never breaking the trail. Empty/single-node traces yield no highlight. */
function tracePathFor(steps: readonly string[], g: Graph): PathHighlight | undefined {
  const present = steps.filter((a) => g.hasNode(a));
  return present.length ? traceHighlight({ steps: present }) : undefined;
}

export function GraphCanvas(props: GraphCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  // The force layout's positions and the folder-clustered positions, both derived
  // from a single forceAtlas2 run so the Folders toggle is a cheap swap, never a
  // relayout (FR-26).
  const basePosRef = useRef<Map<string, XY> | null>(null);
  const clusteredPosRef = useRef<Map<string, XY> | null>(null);
  // Per-folder geometry (hull + label anchor) for the territory overlay (FR-26
  // follow-up), computed alongside the clustered positions in the heavy effect.
  const foldersRef = useRef<FolderRegion[]>([]);
  // The base (force-laid-out) cluster input — captured before any clustering is
  // applied, so changing the folder SORT can re-cluster from the original layout
  // without re-running forceAtlas2 (FR-26 follow-up).
  const baseClusterInputRef = useRef<FolderNode[]>([]);

  // Live state the reducers/handlers read fresh on every refresh — kept in refs
  // so flipping orphan mode or the traced path never triggers the heavy rebuild.
  // (useRef initializers seed them for the first render; the sync effect below
  // keeps them current on every subsequent render without re-running the heavy
  // effect — writing refs during render is disallowed by react-hooks/refs.)
  const orphanRef = useRef(props.orphanMode);
  // FR-61: the manual trace trail (nodes + connecting edges), painted by the path
  // lens. Driven declaratively from the Explorer's trace model via `props.traceSteps`
  // (a light effect + the heavy-rebuild seed below), so it survives a relayout.
  const pathRef = useRef<PathHighlight | undefined>(undefined);
  const traceArmedRef = useRef(props.traceArmed);
  const focusRefHl = useRef<FocusHighlight | null>(null);
  // Layered neighbour analysis (FR-72): address → BFS depth from the selected node,
  // computed upstream and read live by the nodeReducer so dragging the depth slider
  // repaints the shells without re-running forceAtlas2. When present + non-empty it
  // supersedes the first-degree focus lens.
  const layerDepthsRef = useRef<ReadonlyMap<string, number> | undefined>(props.layerDepths);
  // Live graph-diff lens (FR-69): address → change kind (added/changed/moved) between
  // a captured baseline and the live graph, read live by the nodeReducer so injecting
  // or clearing a baseline repaints the diff tint without re-running forceAtlas2.
  const changeMapRef = useRef<ReadonlyMap<string, ChangeKind> | undefined>(props.changeMap);
  // The agent's overlay highlights (FR-37), read live by the nodeReducer so a
  // marks/groups change repaints the tint without re-running the heavy layout.
  const markedRef = useRef<ReadonlyMap<string, string> | undefined>(props.markedNodes);
  const groupedRef = useRef<ReadonlySet<string> | undefined>(props.groupedNodes);
  // "Colour by package" (FR-57): address → its package's recessive base tint. The
  // lowest-priority layer — every lens below overrides it — so it reads as a
  // persistent backdrop, not a competing signal.
  const packageTintRef = useRef<ReadonlyMap<string, string> | undefined>(props.packageTints);
  // The driver's transient highlight (FR-43): a live "look here" set + its colour,
  // read by the nodeReducer above every ambient layer. null when nothing is driven.
  const highlightRef = useRef<{ set: ReadonlySet<string>; color: string } | null>(null);
  // FR-40: in-flight guided-tour step timers. Any controller call cancels them so
  // a manual action (or Take control) preempts the agent's tour cleanly.
  const replayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cbRef = useRef(props);

  // Sync the "latest value" refs after every commit. Declared before the heavy
  // effect so on a data-change render it runs first — the heavy effect then
  // reads a fresh cbRef when it rebuilds.
  useEffect(() => {
    orphanRef.current = props.orphanMode;
    traceArmedRef.current = props.traceArmed;
    markedRef.current = props.markedNodes;
    groupedRef.current = props.groupedNodes;
    packageTintRef.current = props.packageTints;
    layerDepthsRef.current = props.layerDepths;
    changeMapRef.current = props.changeMap;
    cbRef.current = props;
  });

  // Heavy effect: rebuild the layout + renderer only when the data or the
  // projection changes. forceAtlas2 is expensive, so it must not run on a mere
  // orphan/trace toggle.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const projected = projectGraph(props.nodes, props.edges, props.projection);
    const orphanSet = findOrphanAddresses(props.nodes, props.edges);
    const model = buildRenderModel(
      projected.nodes,
      projected.edges,
      undefined,
      undefined,
      undefined,
      undefined,
      orphanSet,
    );
    cbRef.current.onOrphanCount(model.orphanCount);

    const g = new Graph({ type: "directed" });
    for (const n of model.nodes) {
      g.addNode(n.id, {
        label: n.label,
        x: n.x,
        y: n.y,
        size: n.size,
        color: n.color,
        kind: n.kind,
        file: n.file,
        line: n.line,
        orphan: orphanSet.has(n.id),
      });
    }
    for (const e of model.edges) {
      if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
        g.addEdgeWithKey(e.id, e.source, e.target, { color: EDGE_COLOR, size: 1, relation: e.type });
      }
    }
    if (g.order > 2) {
      forceAtlas2.assign(g, {
        iterations: Math.min(400, 100 + g.order),
        settings: forceAtlas2.inferSettings(g),
      });
    }
    graphRef.current = g;
    // FR-61: re-seed the manual trace trail from the live trace model, so changing
    // projection (a heavy rebuild) never wipes a trace the user is assembling.
    pathRef.current = tracePathFor(cbRef.current.traceSteps, g);

    // Snapshot the force layout, then derive the folder-clustered layout from it
    // once (FR-26). Toggling Folders later just swaps between these two maps — no
    // forceAtlas2 rerun. Apply the current mode now so the first paint matches.
    const basePos = new Map<string, XY>();
    g.forEachNode((id, a) => basePos.set(id, { x: a.x as number, y: a.y as number }));
    basePosRef.current = basePos;
    const baseInput = g.mapNodes((id, a) => ({
      id,
      file: (a.file as string) ?? "",
      x: a.x as number,
      y: a.y as number,
    }));
    baseClusterInputRef.current = baseInput;
    const cluster = clusterByFolder(baseInput, undefined, cbRef.current.folderSort);
    clusteredPosRef.current = cluster.positions;
    foldersRef.current = cluster.folders;
    if (cbRef.current.folderClustered) {
      g.forEachNode((id) => {
        const p = clusteredPosRef.current!.get(id);
        if (p) {
          g.setNodeAttribute(id, "x", p.x);
          g.setNodeAttribute(id, "y", p.y);
        }
      });
    }

    const renderer = new Sigma(g, container, {
      defaultEdgeColor: EDGE_COLOR,
      labelColor: { color: "#c9d3e3" },
      labelFont: "ui-monospace, Menlo, monospace",
      labelSize: 11,
      renderLabels: true,
      // Label declutter (FR-27): at the base zoom only the larger nodes get a
      // standing label and the grid thins crowded regions, so a 590-node graph
      // reads instead of drowning in overlapping text. Hover/selection/orphan/
      // trace all set `forceLabel`, which bypasses these thresholds. FR-65: the
      // density + threshold are biased by the "Label density" setting (the live
      // effect below re-applies them when it changes); "balanced" = the prior 0.6/7.
      labelRenderedSizeThreshold: labelDensityProfile(cbRef.current.labelDensity).sigmaThreshold,
      labelDensity: labelDensityProfile(cbRef.current.labelDensity).sigmaDensity,
      labelGridCellSize: 150,
    });
    rendererRef.current = renderer;

    // E2E hook (dev only — `process.env.NODE_ENV` is statically "production" in
    // the static export, so this is tree-shaken out of shipped builds). Exposes
    // the renderer on the container element so a test can resolve a node and fire
    // the real `clickNode` path rather than guessing canvas pixel coordinates.
    if (process.env.NODE_ENV !== "production") {
      (container as unknown as { __sigma?: Sigma }).__sigma = renderer;
    }

    const lod = g.order > 300;
    const camera = renderer.getCamera();
    const activePath = (): PathHighlight | undefined => {
      const hl = pathRef.current;
      return hl && hl.nodes.size > 0 ? hl : undefined;
    };

    renderer.setSetting("nodeReducer", (node, data) => {
      const res: {
        kind?: NodeKind;
        hidden?: boolean;
        color?: string;
        label?: string;
        forceLabel?: boolean;
        highlighted?: boolean;
      } = { ...data };
      if (lod && nodeHiddenAtRatio(data.kind as NodeKind, camera.ratio)) res.hidden = true;
      // "Colour by package" base (FR-57): recolour every node by its package as a
      // persistent backdrop. Applied first so every layer below — mark, group,
      // orphan, path, focus, driver-highlight — still overrides it.
      const pkgTint = packageTintRef.current?.get(node);
      if (pkgTint) res.color = pkgTint;
      // Agent overlay layer (FR-37): the agent's marks + groups tint the graph
      // itself, so it can "point" at nodes, not just annotate the detail panel.
      // Ambient — applied above LOD (a marked node is never culled) but below the
      // interactive orphan/trace/focus lenses, which still take over when engaged.
      // A node's dominant mark wins its colour; an unmarked group member gets the
      // recessive group tint.
      const markColor = markedRef.current?.get(node);
      if (markColor) {
        res.hidden = false;
        res.color = markColor;
        res.forceLabel = true;
      } else if (groupedRef.current?.has(node)) {
        res.color = GROUP_TINT;
      }
      if (orphanRef.current) {
        if (g.getNodeAttribute(node, "orphan")) {
          res.hidden = false;
          res.forceLabel = true;
        } else {
          res.color = ORPHAN_DIM_NODE;
          res.label = "";
        }
      }
      const path = activePath();
      if (path) {
        if (path.nodes.has(node)) {
          res.hidden = false;
          res.forceLabel = true;
          res.color = g.getNodeAttribute(node, "color") as string;
          res.label = g.getNodeAttribute(node, "label") as string;
        } else {
          res.color = ORPHAN_DIM_NODE;
          res.label = "";
        }
      }
      // Layered neighbour analysis (FR-72): when a depth map is present it is the
      // richer focus lens — every node in the selected node's neighbourhood wears
      // its layer's brand hue (depth 0 = the node, brightest; outer shells dim with
      // depth), everything off-lens recedes. Supersedes the first-degree focus lens
      // below, so the two never fight.
      const layers = layerDepthsRef.current;
      const focus = focusRefHl.current;
      if (layers && layers.size > 0) {
        const depth = layers.get(node);
        if (depth !== undefined) {
          res.hidden = false;
          res.color = depth === 0 ? SELECTED_NODE : layerColor(depth);
          res.label = g.getNodeAttribute(node, "label") as string;
          // Force-label only the centre; let Sigma's de-colliding label grid decide
          // which shells label, so physically-close nodes never stack their text
          // (FR-27 declutter). Hover still reveals any node's name.
          if (depth === 0) res.forceLabel = true;
        } else {
          res.color = ORPHAN_DIM_NODE;
          res.label = "";
        }
      } else if (focus) {
        // Neighbour-focus lens (FR-25): a selected node + its first-degree
        // neighbours lead (always labelled), everything else recedes. Applied last
        // so an explicit selection wins over the ambient orphan dim.
        if (focus.nodes.has(node)) {
          const isCenter = node === focus.center;
          res.hidden = false;
          res.color = isCenter ? SELECTED_NODE : (g.getNodeAttribute(node, "color") as string);
          res.label = g.getNodeAttribute(node, "label") as string;
          // Force-label only the centre; neighbours go through Sigma's de-colliding
          // grid so close names never overlap (FR-27). Hover reveals the rest.
          if (isCenter) res.forceLabel = true;
        } else {
          res.color = ORPHAN_DIM_NODE;
          res.label = "";
        }
      }
      // Live graph-diff lens (FR-69): when a change map is present it's the active
      // "what changed" view — every added/changed/moved node wears its diff hue and
      // everything unchanged recedes, so the delta pops. Sits above the focus/layer
      // lenses (the diff is the question being asked) but below the driver highlight,
      // which always wins. Removed nodes aren't in the map — they're gone from this
      // graph, so they only ever appear in the diff panel's change feed.
      const changes = changeMapRef.current;
      if (changes && changes.size > 0) {
        const kind = changes.get(node);
        if (kind) {
          res.hidden = false;
          res.color = DIFF_COLORS[kind];
          res.label = g.getNodeAttribute(node, "label") as string;
          res.forceLabel = true;
        } else {
          res.color = ORPHAN_DIM_NODE;
          res.label = "";
        }
      }
      // Driver highlight (FR-43): the topmost layer — a live "look here" wins over
      // every ambient/lens treatment, even an off-focus dim or a persistent mark,
      // so the agent's pointer is never lost. Clears the moment the driver moves on.
      const hl = highlightRef.current;
      if (hl && hl.set.has(node)) {
        res.hidden = false;
        res.color = hl.color;
        res.label = g.getNodeAttribute(node, "label") as string;
        res.forceLabel = true;
        res.highlighted = true;
      }
      return res;
    });
    renderer.setSetting("edgeReducer", (edge, data) => {
      const res: { hidden?: boolean; color?: string } = { ...data };
      if (lod) {
        const sk = g.getNodeAttribute(g.source(edge), "kind") as NodeKind;
        const tk = g.getNodeAttribute(g.target(edge), "kind") as NodeKind;
        if (nodeHiddenAtRatio(sk, camera.ratio) || nodeHiddenAtRatio(tk, camera.ratio)) {
          res.hidden = true;
        }
      }
      if (orphanRef.current) res.color = ORPHAN_DIM_EDGE;
      const path = activePath();
      if (path) {
        res.color = path.edges.has(pathEdgeKey(g.source(edge), g.target(edge)))
          ? PATH_EDGE
          : ORPHAN_DIM_EDGE;
      }
      // Layered lens (FR-72): an edge whose BOTH endpoints sit in the depth map is
      // internal to the lit neighbourhood — light it; everything else recedes.
      // Supersedes the focus edge emphasis below.
      const layers = layerDepthsRef.current;
      const focus = focusRefHl.current;
      if (layers && layers.size > 0) {
        res.color =
          layers.has(g.source(edge)) && layers.has(g.target(edge)) ? PATH_EDGE : ORPHAN_DIM_EDGE;
      } else if (focus) {
        // Focus lens (FR-25): light up the selected node's incident edges, recede
        // the rest — the same emphasis the trace lens uses.
        res.color = focus.edges.has(pathEdgeKey(g.source(edge), g.target(edge)))
          ? PATH_EDGE
          : ORPHAN_DIM_EDGE;
      }
      // Diff lens (FR-69): an edge whose BOTH endpoints changed wires the changed
      // region together — light it; everything else recedes so the changed nodes
      // pop. Supersedes the focus/layer edge emphasis when the diff is armed.
      const changes = changeMapRef.current;
      if (changes && changes.size > 0) {
        res.color =
          changes.has(g.source(edge)) && changes.has(g.target(edge)) ? PATH_EDGE : ORPHAN_DIM_EDGE;
      }
      return res;
    });
    if (lod) camera.on("updated", () => renderer.refresh());

    renderer.on("enterNode", ({ node }) => cbRef.current.onHoverNode(node));
    renderer.on("leaveNode", () => cbRef.current.onHoverNode(null));
    renderer.on("clickStage", () => {
      cbRef.current.onHoverNode(null);
      cbRef.current.onClearSelection();
    });
    renderer.on("clickNode", ({ node, event }) => {
      // FR-61: while the trace tool is armed, a click extends the manual trace
      // (the Explorer owns the pure model + repaints the trail via props.traceSteps)
      // rather than selecting. Unifies the old two-click "Trace" toggle.
      if (traceArmedRef.current) {
        cbRef.current.onTraceClick?.(node);
        return;
      }
      // FR-71: ctrl/⌘-click peeks the node's connections (a transient highlight of
      // it + its neighbours) WITHOUT selecting — see what it's wired to while
      // keeping your place. A plain click still selects + opens the detail panel.
      // `event` is Sigma's MouseCoords (optional-chained: synthetic emits in tests
      // may omit it, and a missing modifier simply falls through to a plain select).
      const orig = event?.original as { ctrlKey?: boolean; metaKey?: boolean } | undefined;
      if (orig && (orig.ctrlKey || orig.metaKey)) {
        cbRef.current.onPeekNode?.(node);
        return;
      }
      cbRef.current.onSelectNode(node);
    });

    function fitToPath(addresses: readonly string[], ratio = 0.75): void {
      const pts = addresses
        .map((a) => renderer.getNodeDisplayData(a))
        .filter((p): p is NonNullable<typeof p> => p != null);
      if (pts.length === 0) return;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      void renderer.getCamera().animate({ x: cx, y: cy, ratio }, { duration: 420 });
    }

    // FR-40: cancel any in-flight guided tour. Called by every controller entry
    // point so a manual focus/frame/highlight — or the human's Take control, which
    // routes through highlight([]) — preempts the agent's tour at once.
    function cancelReplay(): void {
      for (const t of replayTimersRef.current) clearTimeout(t);
      replayTimersRef.current = [];
    }

    // Expose the imperative surface controller for the parent / FR-39 command bus
    // (FR-43). Generalises the old single focusRef into focus/frame/highlight/replay.
    const controller: SurfaceController = {
      focus(addresses) {
        cancelReplay();
        const present = addresses.filter((a) => g.hasNode(a));
        if (present.length === 0) return;
        cbRef.current.onSelectNode(present[0]);
        fitToPath(present, present.length === 1 ? 0.55 : 0.75);
      },
      frame(addresses) {
        cancelReplay();
        fitToPath(addresses.filter((a) => g.hasNode(a)));
      },
      highlight(addresses, style = "accent") {
        cancelReplay();
        const present = addresses.filter((a) => g.hasNode(a));
        highlightRef.current = present.length
          ? { set: new Set(present), color: HIGHLIGHT_STYLE_COLOR[style] }
          : null;
        renderer.refresh();
      },
      replay(addresses, opts) {
        // FR-40 guided tour: schedule the pure plan's steps on the wall clock. Each
        // step lights the cumulative trail (trace green) and follows the camera; the
        // reduced-motion plan collapses to one instant final-state step. Stepping is
        // transient highlight only — never a selection or a source touch (FR-9).
        cancelReplay();
        // FR-51-deferred: the Settings override beats the OS query (read live).
        const reducedMotion = resolveReducedMotion(cbRef.current.reduceMotion);
        const stops = addresses.filter((a) => g.hasNode(a));
        const plan = planReplay(stops, { dwellMs: opts?.dwellMs, reducedMotion });
        for (const step of plan.steps) {
          const run = (): void => {
            highlightRef.current = {
              set: new Set(step.highlight),
              color: HIGHLIGHT_STYLE_COLOR.trace,
            };
            renderer.refresh();
            fitToPath([step.focus], 0.55);
          };
          if (step.startMs === 0) run();
          else replayTimersRef.current.push(setTimeout(run, step.startMs));
        }
      },
    };
    if (cbRef.current.controllerRef) cbRef.current.controllerRef.current = controller;
    // E2E hook (dev only — tree-shaken from the static export, like __sigma) so a
    // test can drive the controller without reaching into React internals.
    if (process.env.NODE_ENV !== "production") {
      (container as unknown as { __controller?: SurfaceController }).__controller = controller;
    }

    // Folder territory overlay (FR-26 follow-up): when clustering is on, draw a
    // faint hull around each folder's nodes plus its name label, so the clustered
    // map reads as labelled regions — not just relocated dots. A pointer-through
    // SVG layer over Sigma's canvases, re-projected every frame so it stays glued
    // to the nodes through pan/zoom and camera animations. aria-hidden: the canvas
    // graph is already non-semantic (the detail panel + node list carry the
    // accessible structure), so these visual aids never present a partial a11y tree.
    const overlay = document.createElementNS(SVG_NS, "svg");
    overlay.dataset.testid = "folder-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.pointerEvents = "none";
    overlay.style.overflow = "visible";
    container.appendChild(overlay);

    // Screen-px the hull is inflated past the outermost node so it loosely encloses
    // the cluster instead of clipping it.
    const FOLDER_PAD = 22;

    function drawFolderOverlay(): void {
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      if (!cbRef.current.folderClustered) return;
      const regions = topRegions(foldersRef.current);
      const labels = disambiguateFolderLabels(regions);
      for (const region of regions) {
        const hue = folderHue(region.folder);
        const c = renderer.graphToViewport(region.centroid);
        const screen = region.hull.map((p) => renderer.graphToViewport(p));
        let labelY = c.y;
        if (screen.length >= 3) {
          // Inflate each hull vertex outward from the centroid so the outline sits
          // a little beyond the nodes.
          const padded = screen.map((p) => {
            const dx = p.x - c.x;
            const dy = p.y - c.y;
            const len = Math.hypot(dx, dy) || 1;
            return { x: p.x + (dx / len) * FOLDER_PAD, y: p.y + (dy / len) * FOLDER_PAD };
          });
          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute("class", "cg-folder-hull");
          path.setAttribute("d", polygonPath(padded));
          // Each territory gets its OWN tint (stable per folder) so neighbouring
          // folders read as distinct regions, not one undifferentiated grey wash.
          path.setAttribute("fill", withAlpha(hue, 0.09));
          path.setAttribute("stroke", withAlpha(hue, 0.6));
          path.setAttribute("stroke-width", "1.5");
          path.setAttribute("stroke-linejoin", "round");
          overlay.appendChild(path);
          labelY = Math.min(...padded.map((p) => p.y));
        }
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", "cg-folder-label");
        text.setAttribute("x", c.x.toFixed(1));
        text.setAttribute("y", (labelY - 8).toFixed(1));
        text.setAttribute("text-anchor", "middle");
        // Colour the label to match its hull, tying name → territory; the dark halo
        // below keeps it legible wherever it crosses nodes/edges.
        text.setAttribute("fill", hue);
        text.setAttribute("font-size", "11");
        text.setAttribute("font-weight", "600");
        text.setAttribute("font-family", "ui-monospace, Menlo, monospace");
        text.setAttribute("paint-order", "stroke");
        text.setAttribute("stroke", "#0a0a0a");
        text.setAttribute("stroke-width", "3.5");
        text.setAttribute("stroke-linejoin", "round");
        text.textContent = labels.get(region.folder) ?? folderLabel(region.folder);
        overlay.appendChild(text);
      }
    }

    // Redraw glued to the nodes on every Sigma frame (covers pan, zoom, and the
    // camera animation the Folders toggle kicks off). Idle frames don't fire, so
    // this is free when nothing moves.
    renderer.on("afterRender", drawFolderOverlay);
    drawFolderOverlay();

    return () => {
      cancelReplay();
      overlay.remove();
      renderer.kill();
      rendererRef.current = null;
      graphRef.current = null;
      pathRef.current = undefined;
      highlightRef.current = null;
      if (cbRef.current.controllerRef) cbRef.current.controllerRef.current = null;
    };
  }, [props.nodes, props.edges, props.projection]);

  // Light effect: orphan-mode toggled — reducers read orphanRef, just repaint.
  useEffect(() => {
    rendererRef.current?.refresh();
  }, [props.orphanMode]);

  // Light effect: selection (or the edge set) changed — recompute the focus lens
  // and repaint. Keyed off selection + edges, never the heavy layout inputs, so
  // picking a node lights up its neighbourhood without re-running forceAtlas2.
  useEffect(() => {
    focusRefHl.current = focusHighlight(props.selected, props.edges);
    rendererRef.current?.refresh();
  }, [props.selected, props.edges]);

  // Light effect: the agent's overlays changed — the reducers read markedRef /
  // groupedRef live, so a marks/groups update just repaints the tint. Keyed off
  // the overlay maps only, never the heavy layout inputs (no forceAtlas2 rerun).
  useEffect(() => {
    rendererRef.current?.refresh();
  }, [props.markedNodes, props.groupedNodes, props.packageTints]);

  // Light effect: the layered-analysis depth map changed (FR-72) — picking a node
  // or dragging the depth slider rebuilds the map upstream; the reducers read
  // layerDepthsRef live, so this just repaints the shells (no forceAtlas2 rerun).
  useEffect(() => {
    rendererRef.current?.refresh();
  }, [props.layerDepths]);

  // Light effect: the diff lens (FR-69) armed/changed — injecting or clearing a
  // baseline recomputes the change map upstream; the reducers read changeMapRef live,
  // so this just repaints the diff tint (no forceAtlas2 rerun).
  useEffect(() => {
    rendererRef.current?.refresh();
  }, [props.changeMap]);

  // Light effect: FR-65 "Label density" changed — re-apply Sigma's label-thinning
  // thresholds and repaint. No relayout: only the standing-label budget shifts, so
  // a sparser/denser graph reads without re-running the force layout.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const p = labelDensityProfile(props.labelDensity);
    r.setSetting("labelDensity", p.sigmaDensity);
    r.setSetting("labelRenderedSizeThreshold", p.sigmaThreshold);
    r.refresh();
  }, [props.labelDensity]);

  // Light effect: Folders toggled — swap to the clustered (or base) positions and
  // re-frame. No relayout: both maps were computed in the heavy effect (FR-26).
  useEffect(() => {
    const g = graphRef.current;
    const r = rendererRef.current;
    const target = props.folderClustered ? clusteredPosRef.current : basePosRef.current;
    if (!g || !r || !target) return;
    g.forEachNode((id) => {
      const p = target.get(id);
      if (p) {
        g.setNodeAttribute(id, "x", p.x);
        g.setNodeAttribute(id, "y", p.y);
      }
    });
    r.refresh();
    r.getCamera().animatedReset({ duration: 400 });
  }, [props.folderClustered]);

  // Light effect: folder SORT changed — re-cluster from the captured base layout
  // with the new order and refresh the refs (so the overlay + a later toggle use
  // them). When clustering is live, swap in the re-ordered positions and re-frame.
  // No relayout: the base force layout is reused, only the anchors are reassigned.
  useEffect(() => {
    const input = baseClusterInputRef.current;
    const g = graphRef.current;
    const r = rendererRef.current;
    if (input.length === 0 || !g || !r) return;
    const cluster = clusterByFolder(input, undefined, props.folderSort);
    clusteredPosRef.current = cluster.positions;
    foldersRef.current = cluster.folders;
    if (!cbRef.current.folderClustered) return;
    g.forEachNode((id) => {
      const p = cluster.positions.get(id);
      if (p) {
        g.setNodeAttribute(id, "x", p.x);
        g.setNodeAttribute(id, "y", p.y);
      }
    });
    r.refresh();
    r.getCamera().animatedReset({ duration: 400 });
  }, [props.folderSort]);

  // Light effect: the manual trace (FR-61) changed — repaint the trail from the
  // ordered steps, no relayout (the path lens reads pathRef live). The Explorer
  // clears the trace to [] on disarm, so this also handles tearing the trail down.
  useEffect(() => {
    const g = graphRef.current;
    if (g) pathRef.current = tracePathFor(props.traceSteps, g);
    rendererRef.current?.refresh();
  }, [props.traceSteps]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
