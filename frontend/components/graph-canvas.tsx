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
import { projectGraph, type ProjectionKind } from "@core/graph/projection";
import {
  findPathInEdges,
  pathHighlight,
  pathEdgeKey,
  type PathHighlight,
} from "@core/graph/path";
import type { GraphNode, GraphEdge, NodeKind } from "@core/graph/types";
import {
  buildRenderModel,
  findOrphanAddresses,
} from "@adapters/surfaces/webview/render-model";
import { nodeHiddenAtRatio } from "@adapters/surfaces/webview/lod";

// Recessive tones for off-focus elements, shared with the webview surfaces so
// the orphan overlay and trace lens read identically across all three.
const ORPHAN_DIM_NODE = "#39414f";
const ORPHAN_DIM_EDGE = "#262c38";
const PATH_EDGE = "#a78bfa";
const EDGE_COLOR = "#333a4d";

export interface GraphCanvasProps {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly projection: ProjectionKind;
  readonly orphanMode: boolean;
  /** When true, a click picks the path source then traces to the target. */
  readonly traceArmed: boolean;
  /** Hover: the node the pointer is over (its address), or null on leave. */
  readonly onHoverNode: (address: string | null) => void;
  /** A node was clicked while not tracing — select it for the detail panel. */
  readonly onSelectNode: (address: string) => void;
  /** Orphan count for the current projection, reported up for the toggle UI. */
  readonly onOrphanCount: (count: number) => void;
  /** Trace progress: status text for the live region, or "" to clear it. */
  readonly onTraceStatus: (text: string, tone?: "ok" | "none") => void;
  /** Imperative focus handle — parent calls this to pan/zoom to an address. */
  readonly focusRef?: React.MutableRefObject<((address: string) => void) | null>;
}

/** Short, human label for an address (last `::`/`/`-delimited segment). */
function shortName(addr: string): string {
  const tail = addr.split("::").pop() ?? addr;
  return tail.split("/").pop() ?? tail;
}

export function GraphCanvas(props: GraphCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);

  // Live state the reducers/handlers read fresh on every refresh — kept in refs
  // so flipping orphan mode or the traced path never triggers the heavy rebuild.
  // (useRef initializers seed them for the first render; the sync effect below
  // keeps them current on every subsequent render without re-running the heavy
  // effect — writing refs during render is disallowed by react-hooks/refs.)
  const orphanRef = useRef(props.orphanMode);
  const pathRef = useRef<PathHighlight | undefined>(undefined);
  const traceFromRef = useRef<string | undefined>(undefined);
  const traceArmedRef = useRef(props.traceArmed);
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

    const renderer = new Sigma(g, container, {
      defaultEdgeColor: EDGE_COLOR,
      labelColor: { color: "#c9d3e3" },
      labelFont: "ui-monospace, Menlo, monospace",
      labelSize: 11,
      renderLabels: true,
    });
    rendererRef.current = renderer;

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
      return res;
    });
    if (lod) camera.on("updated", () => renderer.refresh());

    renderer.on("enterNode", ({ node }) => cbRef.current.onHoverNode(node));
    renderer.on("leaveNode", () => cbRef.current.onHoverNode(null));
    renderer.on("clickStage", () => cbRef.current.onHoverNode(null));
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
