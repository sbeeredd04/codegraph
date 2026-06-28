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
import { pathEdgeKey } from "@core/graph/path";
import { focusHighlight, type FocusHighlight } from "@core/graph/focus";
import { planReplay } from "@core/presentation/replay";
import type { NodeKind } from "@core/graph/types";
import { buildRenderModel, findOrphanAddresses } from "@adapters/surfaces/webview/render-model";
import { lift3d, project3d, nearestNode, type Point3 } from "@adapters/surfaces/webview/layout3d";
import type { GraphSurfaceProps } from "./graph-surface";
import type { SurfaceController } from "@/lib/surface-controller";
import { GROUP_TINT, HIGHLIGHT_STYLE_COLOR } from "@/lib/overlay-style";

const BG = "#0e0f13";
const EDGE = "120,130,160"; // rgb of the recessive edge tone (alpha applied per-frame)
const FOCUS_EDGE = "167,139,250"; // rgb of the brand-violet focus edge (FR-25)
const DIM_NODE = "#39414f"; // off-focus node tone, shared with the 2D orphan dim
const SELECTED = "#c4b5fd"; // the selected node pops in light violet
const LABEL = "#c9d3e3";
// Above this in-focus node count, neighbour labels are suppressed so selecting a
// hub doesn't simply re-clutter the field — the centre + hovered node still label.
const FOCUS_LABEL_CAP = 18;

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
  // The current focus lens (FR-25) + a handle to the live frame's redraw, both set
  // by the heavy effect, read by the light selection effect below.
  const focusHlRef = useRef<FocusHighlight | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  // The agent's overlay highlights (FR-37), read live by the draw loop so a
  // marks/groups change repaints the tint without re-running the heavy build.
  const markedRef = useRef<ReadonlyMap<string, string> | undefined>(props.markedNodes);
  const groupedRef = useRef<ReadonlySet<string> | undefined>(props.groupedNodes);
  // The driver's transient highlight (FR-43): a live "look here" set + its colour,
  // resolved above the ambient overlay tint in the draw loop. null when undriven.
  const highlightRef = useRef<{ set: ReadonlySet<string>; color: string } | null>(null);
  // FR-40: in-flight guided-tour step timers — mirror the 2D surface so both step
  // identically (AD-15). Any controller call cancels them so a manual action
  // (or Take control) preempts the agent's tour cleanly.
  const replayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Keep callbacks/data current for the handlers without re-running the heavy build.
  useEffect(() => {
    cbRef.current = props;
    markedRef.current = props.markedNodes;
    groupedRef.current = props.groupedNodes;
  });

  // Light effect: selection (or the edge set) changed — recompute the focus lens
  // and ask the live frame to repaint, without re-running the heavy build/layout.
  useEffect(() => {
    focusHlRef.current = focusHighlight(props.selected, props.edges);
    drawRef.current?.();
  }, [props.selected, props.edges]);

  // Light effect: the agent's overlays changed — the draw loop reads the live
  // refs, so a marks/groups update just repaints the tint (no rebuild/relayout).
  useEffect(() => {
    drawRef.current?.();
  }, [props.markedNodes, props.groupedNodes]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Seed the focus lens from the current selection so the first frame already
    // reflects it; the light effect above keeps it current thereafter. Read via
    // the ref so selection is not a heavy-rebuild trigger.
    focusHlRef.current = focusHighlight(cbRef.current.selected, props.edges);

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
    const sceneById = new Map(scene.map((s) => [s.id, s]));
    // The overlay tint a node draws with (FR-37): a mark colour wins, else the
    // group tint, else the node's kind colour. Read the live refs so an overlay
    // change repaints without a rebuild; shared by draw() and the e2e hook so the
    // test asserts exactly what's painted.
    const markColorOf = (id: string): string | undefined => markedRef.current?.get(id);
    const isGrouped = (id: string): boolean => Boolean(groupedRef.current?.has(id));
    const highlightColorOf = (id: string): string | undefined =>
      highlightRef.current?.set.has(id) ? highlightRef.current.color : undefined;
    // The full draw colour, in precedence order: a live driver highlight (FR-43)
    // beats a persistent mark, which beats the group tint, which beats the node's
    // kind colour. draw() and __overlay3d both resolve through this so the painted
    // pixel and the asserted value never drift.
    const drawColorOf = (id: string): string | undefined =>
      highlightColorOf(id) ?? markColorOf(id) ?? (isGrouped(id) ? GROUP_TINT : sceneById.get(id)?.color);

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

      const focus = focusHlRef.current;

      // Edges behind nodes; fade by the nearer endpoint so foreground links read.
      // Under a focus lens (FR-25) the selected node's incident edges light up in
      // brand violet and every other edge drops to a faint wash.
      ctx.lineWidth = 1;
      for (const [s, t] of edges) {
        const a = pos.get(s);
        const b = pos.get(t);
        if (!a || !b) continue;
        const n = Math.max(near(a.depth), near(b.depth));
        if (focus) {
          if (focus.edges.has(pathEdgeKey(s, t))) {
            ctx.strokeStyle = `rgba(${FOCUS_EDGE},${(0.35 + 0.45 * n).toFixed(3)})`;
            ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = `rgba(${EDGE},${(0.015 + 0.03 * n).toFixed(3)})`;
            ctx.lineWidth = 1;
          }
        } else {
          ctx.strokeStyle = `rgba(${EDGE},${(0.06 + 0.16 * n).toFixed(3)})`;
        }
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      // Nodes far→near so foreground discs overdraw background ones. Off-focus
      // nodes desaturate to the dim tone; the selected node grows and pops.
      for (const p of order) {
        const n = near(p.depth);
        const isCenter = focus?.center === p.n.id;
        // Driver highlight (FR-43) is the top layer — a live "look here" pops even
        // through an off-focus dim, so the agent's pointer is never lost. Below it,
        // the agent's persistent overlay tint (FR-37): a marked node wears its mark
        // colour and grows a touch; an unmarked group member takes the recessive
        // tint. Both yield to the focus dim only when NOT highlighted.
        const hlColor = highlightColorOf(p.n.id);
        const markColor = markColorOf(p.n.id);
        const inFocus = Boolean(hlColor) || !focus || focus.nodes.has(p.n.id);
        const baseColor = drawColorOf(p.n.id) ?? p.n.color;
        let r = Math.max(1.5, (2 + p.n.size) * (0.5 + 0.7 * n));
        if (isCenter) r += 2.5;
        else if (hlColor) r += 2;
        else if (markColor) r += 1.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = inFocus
          ? fade(isCenter && !hlColor ? SELECTED : baseColor, 0.35 + 0.65 * n)
          : fade(DIM_NODE, 0.25 + 0.45 * n);
        ctx.fill();
        if (hlColor) {
          // A bright highlight ring is the strongest emphasis on the surface — the
          // 3D echo of the 2D halo; it overrides the hover/centre/mark rings.
          ctx.lineWidth = 2;
          ctx.strokeStyle = hlColor;
          ctx.stroke();
        } else if (p.n.id === hoverId || isCenter) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = isCenter ? SELECTED : LABEL;
          ctx.stroke();
        } else if (markColor && inFocus) {
          // A mark-coloured ring reads the node as a deliberate marker, not just
          // a recoloured disc — the 3D echo of the 2D force-label pop.
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = markColor;
          ctx.stroke();
        }
      }

      // Labels: the hovered node always; under a focus lens the selected node and
      // — when the neighbourhood is small enough to stay legible — its neighbours.
      const toLabel = new Set<string>();
      if (hoverId) toLabel.add(hoverId);
      if (focus) {
        toLabel.add(focus.center);
        if (focus.nodes.size <= FOCUS_LABEL_CAP) {
          for (const id of focus.nodes) toLabel.add(id);
        }
      }
      // The agent's marked nodes label too (its pointer) when visible under the
      // current lens — at rest that's all of them, under focus only the in-focus.
      if (markedRef.current) {
        for (const id of markedRef.current.keys()) {
          if (!focus || focus.nodes.has(id)) toLabel.add(id);
        }
      }
      // A driven highlight always labels — it overrides the focus dim (FR-43).
      if (highlightRef.current) {
        for (const id of highlightRef.current.set) toLabel.add(id);
      }
      if (toLabel.size) {
        ctx.font = "11px ui-monospace, Menlo, monospace";
        ctx.textBaseline = "middle";
        for (const id of toLabel) {
          const p = pos.get(id);
          if (!p) continue;
          ctx.fillStyle = id === focus?.center ? SELECTED : LABEL;
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
    drawRef.current = requestDraw; // let the selection effect repaint this frame

    // E2E hook (dev only — `process.env.NODE_ENV` is statically "production" in
    // the static export, so this is tree-shaken from shipped builds, like the 2D
    // __sigma hook). Returns a node's overlay-resolved draw colour (or null when
    // it's not in the scene) so a test can assert the 3D tint without pixel-
    // sampling the canvas. Resolves through the SAME helpers draw() uses.
    if (process.env.NODE_ENV !== "production") {
      (container as unknown as { __overlay3d?: (a: string) => string | null }).__overlay3d = (
        address: string,
      ): string | null => {
        if (!sceneById.has(address)) return null;
        return drawColorOf(address) ?? null;
      };
    }

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
        else cbRef.current.onClearSelection();
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

    // Pan the camera so a set's centroid sits at the viewport centre (no rotation,
    // no zoom change) — the 3D analogue of the 2D camera.animate fit.
    const frameAddresses = (addresses: readonly string[]): void => {
      const cs = addresses.map((a) => centered.get(a)).filter((c): c is Point3 => c != null);
      if (cs.length === 0) return;
      const ax = cs.reduce((s, c) => s + c.x, 0) / cs.length;
      const ay = cs.reduce((s, c) => s + c.y, 0) / cs.length;
      const az = cs.reduce((s, c) => s + c.z, 0) / cs.length;
      const fit = (Math.min(W, H) * 0.42) / radius;
      const pr = project3d({ x: ax, y: ay, z: az }, yaw, pitch);
      panX = -pr.x * fit * zoom;
      panY = pr.y * fit * zoom;
      requestDraw();
    };

    // FR-40: cancel any in-flight guided tour. Called by every controller entry
    // point so a manual focus/frame/highlight — or the human's Take control, which
    // routes through highlight([]) — preempts the agent's tour at once.
    const cancelReplay = (): void => {
      for (const t of replayTimersRef.current) clearTimeout(t);
      replayTimersRef.current = [];
    };

    // Imperative surface controller (FR-43) — the same contract the 2D canvas
    // implements, against the 3D substrate. Generalises the old focusRef.
    const controller: SurfaceController = {
      focus(addresses) {
        cancelReplay();
        const present = addresses.filter((a) => centered.has(a));
        if (present.length === 0) return;
        frameAddresses(present);
        cbRef.current.onSelectNode(present[0]);
      },
      frame(addresses) {
        cancelReplay();
        frameAddresses(addresses.filter((a) => centered.has(a)));
      },
      highlight(addresses, style = "accent") {
        cancelReplay();
        const present = addresses.filter((a) => centered.has(a));
        highlightRef.current = present.length
          ? { set: new Set(present), color: HIGHLIGHT_STYLE_COLOR[style] }
          : null;
        requestDraw();
      },
      replay(addresses, opts) {
        // FR-40 guided tour on the 3D substrate — schedules the SAME pure plan the
        // 2D surface uses so both step identically (AD-15). Each step lights the
        // cumulative trace trail and pans the camera to the stop; reduced motion
        // collapses to one instant final-state step. Transient highlight only —
        // never a selection or a source touch (FR-9).
        cancelReplay();
        const reducedMotion =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
        const stops = addresses.filter((a) => centered.has(a));
        const plan = planReplay(stops, { dwellMs: opts?.dwellMs, reducedMotion });
        for (const step of plan.steps) {
          const run = (): void => {
            highlightRef.current = {
              set: new Set(step.highlight),
              color: HIGHLIGHT_STYLE_COLOR.trace,
            };
            frameAddresses([step.focus]);
            requestDraw();
          };
          if (step.startMs === 0) run();
          else replayTimersRef.current.push(setTimeout(run, step.startMs));
        }
      },
    };
    if (cbRef.current.controllerRef) cbRef.current.controllerRef.current = controller;
    if (process.env.NODE_ENV !== "production") {
      (container as unknown as { __controller?: SurfaceController }).__controller = controller;
    }

    const ro = new ResizeObserver(() => {
      resize();
      requestDraw();
    });
    ro.observe(container);
    resize();
    draw();

    return () => {
      cancelReplay();
      if (raf) cancelAnimationFrame(raf);
      drawRef.current = null;
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      highlightRef.current = null;
      if (cbRef.current.controllerRef) cbRef.current.controllerRef.current = null;
    };
  }, [props.nodes, props.edges, props.projection]);

  return (
    <div ref={containerRef} data-surface="3d" className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-grab active:cursor-grabbing" />
    </div>
  );
}
