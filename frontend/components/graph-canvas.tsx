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
import {
  findPathInEdges,
  pathHighlight,
  pathEdgeKey,
  type PathHighlight,
} from "@core/graph/path";
import { focusHighlight, type FocusHighlight } from "@core/graph/focus";
import type { NodeKind } from "@core/graph/types";
import {
  buildRenderModel,
  findOrphanAddresses,
} from "@adapters/surfaces/webview/render-model";
import { nodeHiddenAtRatio } from "@adapters/surfaces/webview/lod";
import { clusterByFolder } from "@adapters/surfaces/webview/folder-layout";
import type { GraphSurfaceProps } from "./graph-surface";

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
// Above this in-focus node count the neighbours are no longer force-labelled — the
// label grid thins a hub's dozens of neighbours instead of stacking them (FR-27).
const FOCUS_LABEL_CAP = 16;

// The 2D surface implements the shared render-surface contract (AD-15).
export type GraphCanvasProps = GraphSurfaceProps;

/** Short, human label for an address (last `::`/`/`-delimited segment). */
function shortName(addr: string): string {
  const tail = addr.split("::").pop() ?? addr;
  return tail.split("/").pop() ?? tail;
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

  // Live state the reducers/handlers read fresh on every refresh — kept in refs
  // so flipping orphan mode or the traced path never triggers the heavy rebuild.
  // (useRef initializers seed them for the first render; the sync effect below
  // keeps them current on every subsequent render without re-running the heavy
  // effect — writing refs during render is disallowed by react-hooks/refs.)
  const orphanRef = useRef(props.orphanMode);
  const pathRef = useRef<PathHighlight | undefined>(undefined);
  const traceFromRef = useRef<string | undefined>(undefined);
  const traceArmedRef = useRef(props.traceArmed);
  const focusRefHl = useRef<FocusHighlight | null>(null);
  const cbRef = useRef(props);

  // Sync the "latest value" refs after every commit. Declared before the heavy
  // effect so on a data-change render it runs first — the heavy effect then
  // reads a fresh cbRef when it rebuilds.
  useEffect(() => {
    orphanRef.current = props.orphanMode;
    traceArmedRef.current = props.traceArmed;
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

    // Snapshot the force layout, then derive the folder-clustered layout from it
    // once (FR-26). Toggling Folders later just swaps between these two maps — no
    // forceAtlas2 rerun. Apply the current mode now so the first paint matches.
    const basePos = new Map<string, XY>();
    g.forEachNode((id, a) => basePos.set(id, { x: a.x as number, y: a.y as number }));
    basePosRef.current = basePos;
    clusteredPosRef.current = clusterByFolder(
      g.mapNodes((id, a) => ({
        id,
        file: (a.file as string) ?? "",
        x: a.x as number,
        y: a.y as number,
      })),
    ).positions;
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
      // trace all set `forceLabel`, which bypasses these thresholds.
      labelRenderedSizeThreshold: 7,
      labelDensity: 0.6,
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
      } = { ...data };
      if (lod && nodeHiddenAtRatio(data.kind as NodeKind, camera.ratio)) res.hidden = true;
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
      // Neighbour-focus lens (FR-25): a selected node + its first-degree
      // neighbours lead (always labelled), everything else recedes. Applied last
      // so an explicit selection wins over the ambient orphan dim.
      const focus = focusRefHl.current;
      if (focus) {
        if (focus.nodes.has(node)) {
          const isCenter = node === focus.center;
          res.hidden = false;
          res.color = isCenter ? SELECTED_NODE : (g.getNodeAttribute(node, "color") as string);
          res.label = g.getNodeAttribute(node, "label") as string;
          // Always label the centre; label neighbours too only when the focused
          // set is small enough to read — otherwise let the grid thin a hub's
          // many neighbours rather than force-stacking every label (FR-27).
          if (isCenter || focus.nodes.size <= FOCUS_LABEL_CAP) res.forceLabel = true;
        } else {
          res.color = ORPHAN_DIM_NODE;
          res.label = "";
        }
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
      // Focus lens (FR-25): light up the selected node's incident edges, recede
      // the rest — the same emphasis the trace lens uses.
      const focus = focusRefHl.current;
      if (focus) {
        res.color = focus.edges.has(pathEdgeKey(g.source(edge), g.target(edge)))
          ? PATH_EDGE
          : ORPHAN_DIM_EDGE;
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
    renderer.on("clickNode", ({ node }) => {
      if (!traceArmedRef.current) {
        cbRef.current.onSelectNode(node);
        return;
      }
      handleTraceClick(node);
    });

    // Trace interaction (pure findPathInEdges over the FULL node/edge set, so a
    // projection that hides a node never breaks the route computation).
    function handleTraceClick(node: string): void {
      if (!traceFromRef.current) {
        traceFromRef.current = node;
        pathRef.current = { nodes: new Set([node]), edges: new Set() };
        cbRef.current.onTraceStatus(`From ${shortName(node)} — click a target`);
        renderer.refresh();
        return;
      }
      const from = traceFromRef.current;
      const result = findPathInEdges(
        cbRef.current.nodes.map((n) => ({ address: n.address })),
        cbRef.current.edges,
        from,
        node,
      );
      if (result?.found) {
        pathRef.current = pathHighlight(result);
        const hops = result.length === 1 ? "1 hop" : `${result.length} hops`;
        cbRef.current.onTraceStatus(`${shortName(from)} → ${shortName(node)} · ${hops}`, "ok");
        fitToPath(result.nodes);
      } else {
        pathRef.current = undefined;
        cbRef.current.onTraceStatus(`No path from ${shortName(from)} to ${shortName(node)}`, "none");
      }
      traceFromRef.current = undefined;
      renderer.refresh();
    }

    function fitToPath(addresses: readonly string[]): void {
      const pts = addresses
        .map((a) => renderer.getNodeDisplayData(a))
        .filter((p): p is NonNullable<typeof p> => p != null);
      if (pts.length === 0) return;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      void renderer.getCamera().animate({ x: cx, y: cy, ratio: 0.75 }, { duration: 420 });
    }

    // Expose an imperative focus handle for the parent (palette/detail jumps).
    if (cbRef.current.focusRef) {
      cbRef.current.focusRef.current = (address: string) => {
        if (!g.hasNode(address)) return;
        const pos = renderer.getNodeDisplayData(address);
        if (pos) void renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.55 }, { duration: 420 });
        cbRef.current.onSelectNode(address);
      };
    }

    return () => {
      renderer.kill();
      rendererRef.current = null;
      graphRef.current = null;
      pathRef.current = undefined;
      traceFromRef.current = undefined;
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

  // Disarming trace clears any in-progress source + highlight.
  useEffect(() => {
    if (!props.traceArmed) {
      traceFromRef.current = undefined;
      pathRef.current = undefined;
      cbRef.current.onTraceStatus("");
      rendererRef.current?.refresh();
    }
  }, [props.traceArmed]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
