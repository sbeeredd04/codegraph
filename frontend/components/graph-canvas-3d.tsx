"use client";

// 3D graph surface (FR-17). The swappable sibling of the 2D Sigma canvas: it
// consumes the SAME projected graph + render model + 2D force layout, then lifts
// that layout into a 3D box (lift3d) and draws an orthographic, drag-to-rotate
// projection of it on a plain 2D canvas. No WebGL library and no new dependency —
// the only hard logic (the 3D box, the yaw/pitch projection, hit-testing) lives in
// the pure, unit-tested @adapters/layout3d, so this file stays a thin imperative
// shell. Mounted client-only (next/dynamic ssr:false) since it touches the canvas
// + ResizeObserver at module-free runtime.

import { useEffect, useRef } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { projectGraph } from "@core/graph/projection";
import type { NodeKind } from "@core/graph/types";
import { buildRenderModel, findOrphanAddresses } from "@adapters/surfaces/webview/render-model";
import { lift3d, project3d, nearestNode, type Point3 } from "@adapters/surfaces/webview/layout3d";
import type { GraphSurfaceProps } from "./graph-surface";

const BG = "#0e0f13";
const EDGE = "120,130,160"; // rgb of the recessive edge tone (alpha applied per-frame)
const LABEL = "#c9d3e3";

interface SceneNode {
  readonly id: string;
  readonly p: Point3;
  readonly size: number;
  readonly color: string;
  readonly label: string;
}

/** Mix a hex colour toward the background by `t` (0 = bg, 1 = colour) — depth fade. */
function fade(hex: string, t: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const br = 0x0e;
  const bg = 0x0f;
  const bb = 0x13;
  const m = (c: number, bc: number): number => Math.round(bc + (c - bc) * t);
  return `rgb(${m(r, br)},${m(g, bg)},${m(b, bb)})`;
}

export function GraphCanvas3D(props: GraphSurfaceProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cbRef = useRef(props);

  // Keep callbacks/data current for the handlers without re-running the heavy build.
  useEffect(() => {
    cbRef.current = props;
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // --- Build the scene: same projection + 2D layout as the Sigma surface, lifted to 3D.
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
      g.addNode(n.id, { x: n.x, y: n.y, size: n.size, color: n.color, kind: n.kind, label: n.label });
    }
    for (const e of model.edges) {
      if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.source, e.target)) {
        g.addEdgeWithKey(e.id, e.source, e.target);
      }
    }
    if (g.order > 2) {
      forceAtlas2.assign(g, {
        iterations: Math.min(400, 100 + g.order),
        settings: forceAtlas2.inferSettings(g),
      });
    }

    const lifted = lift3d(
      g.mapNodes((id, a) => ({ id, kind: a.kind as NodeKind, x: a.x as number, y: a.y as number })),
    );
    const scene: SceneNode[] = [];
    for (const id of g.nodes()) {
      const p = lifted.get(id);
      if (!p) continue;
      const a = g.getNodeAttributes(id);
      scene.push({ id, p, size: a.size as number, color: a.color as string, label: a.label as string });
    }
    const edges: ReadonlyArray<readonly [string, string]> = g.mapEdges(
      (_e, _a, s, t) => [s, t] as const,
    );

    // Centre the box so rotation pivots about the graph's middle, and pick a fit
    // scale from its 3D radius so the whole graph stays framed at any rotation.
    const cx = scene.reduce((s, n) => s + n.p.x, 0) / (scene.length || 1);
    const cy = scene.reduce((s, n) => s + n.p.y, 0) / (scene.length || 1);
    const cz = scene.reduce((s, n) => s + n.p.z, 0) / (scene.length || 1);
    let radius = 1;
    for (const n of scene) {
      const dx = n.p.x - cx;
      const dy = n.p.y - cy;
      const dz = n.p.z - cz;
      radius = Math.max(radius, Math.hypot(dx, dy, dz));
    }
    const centered = new Map<string, Point3>(
      scene.map((n) => [n.id, { x: n.p.x - cx, y: n.p.y - cy, z: n.p.z - cz }]),
    );

    // --- Camera state (mutable; redraw on change).
    let yaw = 0.6;
    let pitch = -0.35;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let hoverId: string | null = null;
    let W = container.clientWidth || 1;
    let H = container.clientHeight || 1;
    // Screen positions from the last frame (ordered far→near) for hit-testing.
    let screen: { id: string; x: number; y: number }[] = [];

    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const resize = (): void => {
      W = container.clientWidth || 1;
      H = container.clientHeight || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (): void => {
      const fit = (Math.min(W, H) * 0.42) / radius;
      const k = fit * zoom;
      // Project every node, capture depth for ordering + cueing.
      const pts = scene.map((n) => {
        const pr = project3d(centered.get(n.id)!, yaw, pitch);
        return { n, sx: W / 2 + panX + pr.x * k, sy: H / 2 + panY - pr.y * k, depth: pr.depth };
      });
      let minD = Infinity;
      let maxD = -Infinity;
      for (const p of pts) {
        if (p.depth < minD) minD = p.depth;
        if (p.depth > maxD) maxD = p.depth;
      }
      const near = (d: number): number => (maxD > minD ? (d - minD) / (maxD - minD) : 1);
      const order = [...pts].sort((a, b) => a.depth - b.depth); // far first
      const pos = new Map(pts.map((p) => [p.n.id, p]));

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);

      // Edges behind nodes; fade by the nearer endpoint so foreground links read.
      ctx.lineWidth = 1;
      for (const [s, t] of edges) {
        const a = pos.get(s);
        const b = pos.get(t);
        if (!a || !b) continue;
        const n = Math.max(near(a.depth), near(b.depth));
        ctx.strokeStyle = `rgba(${EDGE},${(0.06 + 0.16 * n).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      // Nodes far→near so foreground discs overdraw background ones.
      for (const p of order) {
        const n = near(p.depth);
        const r = Math.max(1.5, (2 + p.n.size) * (0.5 + 0.7 * n));
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = fade(p.n.color, 0.35 + 0.65 * n);
        ctx.fill();
        if (p.n.id === hoverId) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = LABEL;
          ctx.stroke();
        }
      }

      // Label only the hovered node, to keep the field uncluttered.
      if (hoverId) {
        const p = pos.get(hoverId);
        if (p) {
          ctx.font = "11px ui-monospace, Menlo, monospace";
          ctx.fillStyle = LABEL;
          ctx.textBaseline = "middle";
          ctx.fillText(p.n.label, p.sx + 8, p.sy);
        }
      }

      screen = order.map((p) => ({ id: p.n.id, x: p.sx, y: p.sy }));
    };

    // rAF-coalesced redraw.
    let raf = 0;
    const requestDraw = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    };

    // --- Interaction: drag = rotate, wheel = zoom, click = select, hover = highlight.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;

    const pointAt = (e: PointerEvent): { mx: number; my: number } => {
      const rect = canvas.getBoundingClientRect();
      return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent): void => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        yaw += dx * 0.006;
        pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.006));
        requestDraw();
        return;
      }
      const { mx, my } = pointAt(e);
      const hit = nearestNode(screen, mx, my, 12);
      if (hit !== hoverId) {
        hoverId = hit;
        cbRef.current.onHoverNode(hit);
        requestDraw();
      }
    };
    const onUp = (e: PointerEvent): void => {
      if (dragging && moved < 4) {
        const { mx, my } = pointAt(e);
        const hit = nearestNode(screen, mx, my, 12);
        if (hit) cbRef.current.onSelectNode(hit);
      }
      dragging = false;
    };
    const onLeave = (): void => {
      if (hoverId) {
        hoverId = null;
        cbRef.current.onHoverNode(null);
        requestDraw();
      }
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      zoom = Math.max(0.2, Math.min(6, zoom * Math.exp(-e.deltaY * 0.001)));
      requestDraw();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Imperative focus: re-centre the camera on an address, then select it.
    if (cbRef.current.focusRef) {
      cbRef.current.focusRef.current = (address: string) => {
        const c = centered.get(address);
        if (!c) return;
        const fit = (Math.min(W, H) * 0.42) / radius;
        const pr = project3d(c, yaw, pitch);
        panX = -pr.x * fit * zoom;
        panY = pr.y * fit * zoom;
        requestDraw();
        cbRef.current.onSelectNode(address);
      };
    }

    const ro = new ResizeObserver(() => {
      resize();
      requestDraw();
    });
    ro.observe(container);
    resize();
    draw();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      if (cbRef.current.focusRef) cbRef.current.focusRef.current = null;
    };
  }, [props.nodes, props.edges, props.projection]);

  return (
    <div ref={containerRef} data-surface="3d" className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-grab active:cursor-grabbing" />
    </div>
  );
}
