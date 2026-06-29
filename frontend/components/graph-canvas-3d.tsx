"use client";

// 3D graph surface (FR-17 / FR-46). The swappable sibling of the 2D Sigma canvas:
// it consumes the SAME projected graph + render model, lays the nodes out in a TRUE
// 3D force-directed field (d3-force-3d) and renders them with real WebGL perspective
// — instanced spheres lit by a key/rim pair, fog depth-cueing, 3D edges, HTML-overlay
// labels — replacing the earlier fake 2.5D kind-band projection. three.js core is
// eval-free so it boots under the strict webview nonce CSP (graph3d-csp-smoke); three
// + d3-force-3d are dynamic-imported inside the effect, off the boot path.
//
// The substrate changed but the SURFACE CONTRACT did not (AD-15): same
// `data-surface="3d"` container + single <canvas>, same dev `__overlay3d` /
// `__controller` / `__cameraState` / `__movie` hooks, same `controllerRef`, same
// overlay-tint / focus-lens / driver-highlight / guided-tour state machine — so the
// Explorer swaps surfaces without touching its call-site and the FR-37 / FR-40
// parity e2e assert identical behaviour on both.

import { useEffect, useRef, useState } from "react";
import type * as ThreeNS from "three"; // type-only — values come from the dynamic import
import { traceHighlight } from "@core/graph/trace";
import { focusHighlight, type FocusHighlight } from "@core/graph/focus";
import { buildEdges3D } from "@/lib/edges-3d";
import { buildEntryMarkers3D } from "@/lib/entry-markers-3d";
import { buildCameraControls3D } from "@/lib/camera-controls-3d";
import { planReplay } from "@core/presentation/replay";
import { buildScene3D } from "@/lib/build-scene-3d";
import type { GraphSurfaceProps } from "./graph-surface";
import type { SurfaceController } from "@/lib/surface-controller";
import { GROUP_TINT, HIGHLIGHT_STYLE_COLOR } from "@/lib/overlay-style";
import { INACTIVE_MOVIE, type MovieState } from "@/lib/movie-player-3d";
import { createSurfaceMovie, type MovieControlsApi } from "@/lib/surface-movie-3d";
import { installSurface3DDevHooks } from "@/lib/surface-dev-hooks-3d";
import { Maximize, RotateCcw, Orbit } from "./icons";
import { MovieControls3D } from "./movie-controls-3d";

const BG = 0x0e0f13; // canvas + fog colour (matches the 2D surface)
const DIM_NODE = 0x39414f; // off-focus node tone, shared with the 2D orphan dim
const SELECTED = 0xc4b5fd; // the selected node pops in light violet
const SELECTED_HEX = "#c4b5fd";
const LABEL_HEX = "#c9d3e3";
const WORLD = 60; // the layout is normalised to this radius in world units
// Default camera pose, tween timing + zoom bounds (FR-47) now live with the camera
// controller in lib/camera-controls-3d.
const MOVIE_CLOSE_RADIUS = WORLD * 1.2; // close-up orbit distance per movie stop (FR-48)
// Above this in-focus node count, neighbour labels are suppressed so selecting a
// hub doesn't re-clutter the field — the centre + hovered node still label.
const FOCUS_LABEL_CAP = 18;

export function GraphCanvas3D(props: GraphSurfaceProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(props);
  // The current focus lens (FR-25) + a handle to the live frame's redraw, both set
  // by the heavy effect, read by the light selection effect below.
  const focusHlRef = useRef<FocusHighlight | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  // The agent's overlay highlights (FR-37), read live by the draw loop so a
  // marks/groups change repaints the tint without re-running the heavy build.
  const markedRef = useRef<ReadonlyMap<string, string> | undefined>(props.markedNodes);
  const groupedRef = useRef<ReadonlySet<string> | undefined>(props.groupedNodes);
  // FR-57: "colour by package" tints (address → recessive base colour), read live.
  const packageTintRef = useRef<ReadonlyMap<string, string> | undefined>(props.packageTints);
  // The driver's transient highlight (FR-43): a live "look here" set + its colour,
  // resolved above the ambient overlay tint in the draw loop. null when undriven.
  const highlightRef = useRef<{ set: ReadonlySet<string>; color: string } | null>(null);
  // FR-61: the manual execution trace's node set, tinted trace-green in the draw
  // loop (the 3D parallel of the 2D path lens). Driven declaratively from the
  // Explorer's trace model via props.traceSteps (seed + light effect), so it
  // survives a rebuild; null when the trace is empty.
  const traceRef = useRef<ReadonlySet<string> | null>(null);
  // FR-65a: the trace's connecting EDGE keys (pathEdgeKey per consecutive step),
  // so the 3D edge pass tints the route's wiring trace-green like the 2D path lens
  // — not just the nodes. Derived alongside traceRef from the same core helper.
  const traceEdgeRef = useRef<ReadonlySet<string> | null>(null);
  // FR-40: in-flight guided-tour step timers — mirror the 2D surface so both step
  // identically (AD-15). Any controller call cancels them so a manual action
  // (or Take control) preempts the agent's tour cleanly.
  const replayTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // FR-47: the mounted surface publishes its imperative camera API here so the
  // on-canvas Reset / Fit affordance (rendered in React) can drive the camera.
  const camApiRef = useRef<{ reset: () => void; fit: () => void } | null>(null);
  // FR-48 movie mode: the surface publishes its player controls here (driven by the
  // React transport bar) and pushes live progress into `movie` state for that bar.
  const movieApiRef = useRef<MovieControlsApi | null>(null);
  const [movie, setMovie] = useState<MovieState>(INACTIVE_MOVIE);
  const setMovieRef = useRef(setMovie); // stable setter, read inside the heavy effect

  // Keep callbacks/data current for the handlers without re-running the heavy build.
  useEffect(() => {
    cbRef.current = props;
    markedRef.current = props.markedNodes;
    groupedRef.current = props.groupedNodes;
    packageTintRef.current = props.packageTints;
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
  }, [props.markedNodes, props.groupedNodes, props.packageTints]);

  // Light effect: the manual trace (FR-61) changed — repaint the trail from the
  // ordered steps (the draw loop reads traceRef live). The Explorer clears the
  // trace to [] on disarm, so this also tears the trail down. No rebuild/relayout.
  useEffect(() => {
    const th = props.traceSteps.length ? traceHighlight({ steps: props.traceSteps }) : null;
    traceRef.current = th?.nodes ?? null;
    traceEdgeRef.current = th?.edges ?? null;
    drawRef.current?.();
  }, [props.traceSteps]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const labelLayer = labelsRef.current;
    if (!container || !canvas || !labelLayer) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    // three + d3-force-3d are heavy; load them off the boot path. The component is
    // already code-split (next/dynamic ssr:false), and this defers the chunks again
    // until a 3D mount actually happens. Everything below runs once they resolve.
    void (async () => {
      const THREE = await import("three");
      const { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } =
        await import("d3-force-3d");
      if (disposed) return;

      // Seed the focus lens from the current selection so the first frame already
      // reflects it; the light effect above keeps it current thereafter.
      focusHlRef.current = focusHighlight(cbRef.current.selected, props.edges);
      // FR-61: re-seed the manual trace trail so a rebuild (new projection/data)
      // doesn't wipe a trace the user is assembling; the light effect keeps it current.
      {
        const th = cbRef.current.traceSteps.length
          ? traceHighlight({ steps: cbRef.current.traceSteps })
          : null;
        traceRef.current = th?.nodes ?? null;
        traceEdgeRef.current = th?.edges ?? null;
      }
      // A rebuild (new dataset/projection) invalidates any in-flight movie tour.
      setMovieRef.current(INACTIVE_MOVIE);

      // --- Scene model: projection + render model + 3D force layout (lib/build-scene-3d).
      const { ids, indexOf, meta, metaById, edgePairs, positions, orphanCount } = buildScene3D(
        { nodes: props.nodes, edges: props.edges, projection: props.projection, world: WORLD },
        { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide },
      );
      cbRef.current.onOrphanCount(orphanCount);
      const pos = positions.map((p) => new THREE.Vector3(p.x, p.y, p.z));

      // --- WebGL scene.
      const widthOf = (): number => container.clientWidth || 1;
      const heightOf = (): number => container.clientHeight || 1;
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(BG);
      scene.fog = new THREE.Fog(BG, WORLD * 1.15, WORLD * 3.6); // depth cueing

      // FR-47 camera controller (lib/camera-controls-3d) owns the perspective camera,
      // orbit pose, and the shared eased tween. It calls back into the component's
      // render loop: the coalesced requestRender after manual input, and drawTweenFrame
      // per tween step (both defined below — invoked only post-init, so the forward
      // references are safe).
      const prefersReducedMotion = (): boolean =>
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      const cam = buildCameraControls3D(THREE, {
        world: WORLD,
        widthOf,
        heightOf,
        requestRender: () => requestRender(),
        drawFrame: () => drawTweenFrame(),
        prefersReducedMotion,
      });
      const camera = cam.camera;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(dpr);
      renderer.setSize(widthOf(), heightOf(), false);

      scene.add(new THREE.AmbientLight(0xffffff, 0.72));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
      keyLight.position.set(0.6, 1, 0.8);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x8b9bff, 0.35);
      rimLight.position.set(-0.7, -0.4, -0.6);
      scene.add(rimLight);

      // Nodes as one instanced sphere mesh (per-instance position/scale + colour).
      const sphereGeo = new THREE.SphereGeometry(1, 18, 14);
      const nodeMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
      const mesh = new THREE.InstancedMesh(sphereGeo, nodeMat, ids.length || 1);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);

      // Edges (FR-65a): geometry built once; colours recompute per lens in
      // lib/edges-3d. The trail tints trace-green (matching the node tint) over
      // focus-violet, off-lens edges dim — mirroring the 2D path lens.
      const edges = buildEdges3D(
        THREE,
        edgePairs,
        (id) => {
          const i = indexOf.get(id);
          return i == null ? undefined : pos[i];
        },
        HIGHLIGHT_STYLE_COLOR.trace,
      );
      scene.add(edges.object);

      // Entry-point markers (FR-56): emerald rings on the nodes the pure-core
      // heuristic flags — the 3D match for the detail panel's badge (lib/entry-markers-3d).
      const entryMarkers = buildEntryMarkers3D(THREE, { nodes: props.nodes, edges: props.edges, indexOf, positions: pos, meta }); // prettier-ignore
      scene.add(entryMarkers.object);

      const colDim = new THREE.Color(DIM_NODE);
      const colSelected = new THREE.Color(SELECTED);
      const tmpColor = new THREE.Color();
      const dummy = new THREE.Object3D();

      // --- Overlay-colour resolution (identical precedence to the 2D surface): a
      // live driver highlight (FR-43) beats a persistent mark (FR-37), which beats
      // the group tint, which beats the node's kind colour. draw() and __overlay3d
      // resolve through the same helpers so the painted instance and the asserted
      // value never drift.
      const markColorOf = (id: string): string | undefined => markedRef.current?.get(id);
      const isGrouped = (id: string): boolean => Boolean(groupedRef.current?.has(id));
      const highlightColorOf = (id: string): string | undefined =>
        highlightRef.current?.set.has(id) ? highlightRef.current.color : undefined;
      // FR-61: a node on the manual trace tints trace-green — below a live driver
      // highlight/mark (so the agent's pointer still wins) but above the group tint
      // and kind colour, so a deliberately-traced route stands out on the field.
      const traceColorOf = (id: string): string | undefined =>
        traceRef.current?.has(id) ? HIGHLIGHT_STYLE_COLOR.trace : undefined;
      // FR-57: the package tint is the recessive base — below group, above kind.
      const drawColorOf = (id: string): string | undefined =>
        highlightColorOf(id) ??
        markColorOf(id) ??
        traceColorOf(id) ??
        (isGrouped(id) ? GROUP_TINT : (packageTintRef.current?.get(id) ?? metaById.get(id)?.color));

      // Hover state (not camera pose) — read by applyOverlays + renderLabels for the
      // hover scale/label, set by the pointer handlers. The camera pose + projection
      // now live in the FR-47 controller (cam.*).
      let hoverId: string | null = null;

      // Recompute per-instance colour/scale + edge colours from the live overlay /
      // focus / highlight state. Cheap (one pass over nodes + edges), runs only on
      // a real change since the draw loop is on-demand.
      const applyOverlays = (): void => {
        const focus = focusHlRef.current;
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          const hlColor = highlightColorOf(id);
          const markColor = markColorOf(id);
          const traceColor = traceColorOf(id);
          const isCenter = focus?.center === id;
          // A trace node leads through a focus lens (FR-61), like a driver highlight.
          const inFocus = Boolean(hlColor) || Boolean(traceColor) || !focus || focus.nodes.has(id);
          const drawn = drawColorOf(id) ?? meta[i].color;
          if (!inFocus) tmpColor.copy(colDim);
          else if (isCenter && !hlColor) tmpColor.copy(colSelected);
          else tmpColor.set(drawn);
          mesh.setColorAt(i, tmpColor);

          let r = 0.7 + meta[i].size * 0.16;
          if (isCenter) r += 0.9;
          else if (hlColor) r += 0.8;
          else if (markColor || traceColor) r += 0.5;
          else if (id === hoverId) r += 0.45;
          if (!inFocus) r *= 0.82;
          dummy.position.copy(pos[i]);
          dummy.scale.setScalar(r);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        // FR-65a: a trace lens dims off-route edges just like a focus lens, so the
        // green trail reads as a continuous lit path even with no selection (the
        // trace tint wins over focus-violet — a deliberate route beats the lens).
        edges.apply(focus, traceEdgeRef.current);
      };

      // Labels: an HTML overlay (crisp text, app typography) projected each frame.
      // Node labels are structural symbol/path text — set via textContent, never
      // innerHTML, so nothing renders as markup (FR untrusted-content discipline).
      const renderLabels = (): void => {
        const focus = focusHlRef.current;
        const toLabel = new Set<string>();
        if (hoverId) toLabel.add(hoverId);
        if (focus) {
          toLabel.add(focus.center);
          if (focus.nodes.size <= FOCUS_LABEL_CAP) for (const id of focus.nodes) toLabel.add(id);
        }
        if (markedRef.current) {
          for (const id of markedRef.current.keys()) if (!focus || focus.nodes.has(id)) toLabel.add(id);
        }
        if (highlightRef.current) for (const id of highlightRef.current.set) toLabel.add(id);
        if (traceRef.current) for (const id of traceRef.current) toLabel.add(id); // FR-61: label traced nodes

        labelLayer.replaceChildren();
        if (!toLabel.size) return;
        for (const id of toLabel) {
          const i = indexOf.get(id);
          if (i == null) continue;
          const sp = cam.projectToScreen(pos[i]);
          if (sp.z > 1) continue; // behind the camera
          const el = document.createElement("div");
          el.textContent = meta[i].label;
          el.className = "absolute -translate-y-1/2 whitespace-nowrap font-mono text-[11px] leading-none";
          el.style.left = `${sp.x + 10}px`;
          el.style.top = `${sp.y}px`;
          el.style.color = id === focus?.center ? SELECTED_HEX : LABEL_HEX;
          el.style.textShadow = "0 1px 3px rgba(0,0,0,0.85)";
          labelLayer.appendChild(el);
        }
      };

      // On-demand, rAF-coalesced render (battery-friendly — no idle loop).
      let raf = 0;
      const renderFrame = (): void => {
        raf = 0;
        applyOverlays();
        renderer.render(scene, camera);
        renderLabels();
      };
      const requestRender = (): void => {
        if (raf) return;
        raf = requestAnimationFrame(renderFrame);
      };
      drawRef.current = requestRender; // let the light effects repaint this frame

      // The per-frame draw the FR-47 camera tween calls: render + project labels, but
      // skip the overlay recompute (tints don't change while only the camera moves).
      const drawTweenFrame = (): void => {
        renderer.render(scene, camera);
        renderLabels();
      };

      // FR-40: cancel any in-flight guided tour. Called by every controller entry
      // point (and by starting a movie) so a manual focus/frame/highlight — or the
      // human's Take control, which routes through highlight([]) — preempts the
      // agent's tour at once.
      const cancelReplay = (): void => {
        for (const t of replayTimersRef.current) clearTimeout(t);
        replayTimersRef.current = [];
      };

      // FR-48 cinematic movie mode: walk an ordered node path, flying the camera to
      // a close-up of each stop (reusing the FR-47 tween) and lighting it with the
      // trace highlight. The player is substrate-agnostic (lib/movie-player-3d); this
      // wires it to the surface primitives. The "play focus" path is the selected
      // node's neighbourhood — centre first, then its focus-lens neighbours in order.
      const { player: moviePlayer, playFocus: playMovieFocus } = createSurfaceMovie({
        resolve: (address) => {
          const i = indexOf.get(address);
          if (i == null) return null;
          return { x: pos[i].x, y: pos[i].y, z: pos[i].z, label: metaById.get(address)?.label ?? address };
        },
        flyTo: (p, ms) => cam.tweenTo({ tx: p.x, ty: p.y, tz: p.z, radius: MOVIE_CLOSE_RADIUS }, ms),
        setHighlight: (highlight) => {
          highlightRef.current = highlight;
          requestRender();
        },
        prefersReducedMotion,
        publish: (s) => setMovieRef.current(s),
        cancelAgentTour: cancelReplay,
        focusPath: () => {
          const f = focusHlRef.current;
          return f ? [f.center, ...ids.filter((id) => id !== f.center && f.nodes.has(id))] : [];
        },
      });
      movieApiRef.current = {
        playFocus: playMovieFocus,
        toggle: moviePlayer.toggle,
        next: moviePlayer.next,
        prev: moviePlayer.prev,
        stop: moviePlayer.stop,
      };

      const resize = (): void => {
        renderer.setSize(widthOf(), heightOf(), false);
        cam.resize(); // re-read aspect + update the projection matrix
      };

      // Hit-testing: raycast the instanced spheres first, then a forgiving 14px
      // screen-space nearest fallback so small distant nodes stay clickable.
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const pickAt = (mx: number, my: number): string | null => {
        ndc.set((mx / widthOf()) * 2 - 1, -(my / heightOf()) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObject(mesh);
        if (hits.length && hits[0].instanceId != null) return ids[hits[0].instanceId];
        let best: string | null = null;
        let bestD2 = 14 * 14;
        for (let i = 0; i < ids.length; i++) {
          const sp = cam.projectToScreen(pos[i]);
          if (sp.z > 1) continue;
          const dx = sp.x - mx;
          const dy = sp.y - my;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD2) {
            bestD2 = d2;
            best = ids[i];
          }
        }
        return best;
      };

      // --- Interaction: drag = orbit; shift/right/middle-drag = pan; wheel = zoom;
      // click = select; hover = highlight. The owner's "enable everything" — full
      // orbit/pan/zoom; the camera math itself lives in the FR-47 controller (cam.*).
      let dragging = false;
      let panning = false;
      let lastX = 0;
      let lastY = 0;
      let moved = 0;
      const localXY = (e: PointerEvent): { mx: number; my: number } => {
        const rect = canvas.getBoundingClientRect();
        return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
      };
      const onDown = (e: PointerEvent): void => {
        cam.cancelTween(); // manual control preempts an in-flight camera tween
        moviePlayer.stop(); // grabbing the canvas (orbit/pan or a new pick) ends a movie
        dragging = true;
        panning = e.shiftKey || e.button === 1 || e.button === 2;
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
          if (panning) cam.pan(dx, dy);
          else cam.orbit(dx, dy);
          requestRender();
          return;
        }
        const { mx, my } = localXY(e);
        const hit = pickAt(mx, my);
        if (hit !== hoverId) {
          hoverId = hit;
          cbRef.current.onHoverNode(hit);
          requestRender();
        }
      };
      const onUp = (e: PointerEvent): void => {
        if (dragging && moved < 4) {
          const { mx, my } = localXY(e);
          const hit = pickAt(mx, my);
          // FR-61: a click while the trace tool is armed extends the manual trace
          // (forwarded to the Explorer) instead of selecting — same as the 2D surface.
          if (hit) {
            if (cbRef.current.traceArmed) cbRef.current.onTraceClick?.(hit);
            else cbRef.current.onSelectNode(hit);
          } else cbRef.current.onClearSelection();
        }
        dragging = false;
        panning = false;
      };
      const onLeave = (): void => {
        if (hoverId) {
          hoverId = null;
          cbRef.current.onHoverNode(null);
          requestRender();
        }
      };
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        cam.cancelTween(); // manual zoom preempts an in-flight camera tween
        moviePlayer.stop(); // manual zoom ends a movie
        cam.zoom(e.deltaY);
        requestRender();
      };
      const onContext = (e: Event): void => e.preventDefault();

      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", onContext);

      // Pan the camera so a node set's centroid sits at the viewport centre (no
      // rotation, no zoom change) — resolves addresses to world positions, then
      // delegates the centroid fly-to to the FR-47 controller (the 3D camera fit).
      const frameAddresses = (addresses: readonly string[]): void => {
        const present: ThreeNS.Vector3[] = [];
        for (const a of addresses) {
          const i = indexOf.get(a);
          if (i != null) present.push(pos[i]);
        }
        cam.frame(present);
      };

      // FR-47: Reset returns the camera to its default 3/4 pose; Fit reframes the whole
      // graph from the CURRENT orbit angle (both in the cam controller). The React
      // affordance below drives these through camApiRef.
      camApiRef.current = { reset: cam.reset, fit: cam.fit };

      // Imperative surface controller (FR-43) — the same contract the 2D canvas
      // implements, against the 3D substrate.
      const controller: SurfaceController = {
        focus(addresses) {
          cancelReplay();
          const present = addresses.filter((a) => indexOf.has(a));
          if (present.length === 0) return;
          frameAddresses(present);
          cbRef.current.onSelectNode(present[0]);
        },
        frame(addresses) {
          cancelReplay();
          frameAddresses(addresses.filter((a) => indexOf.has(a)));
        },
        highlight(addresses, style = "accent") {
          cancelReplay();
          const present = addresses.filter((a) => indexOf.has(a));
          highlightRef.current = present.length
            ? { set: new Set(present), color: HIGHLIGHT_STYLE_COLOR[style] }
            : null;
          requestRender();
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
          const stops = addresses.filter((a) => indexOf.has(a));
          const plan = planReplay(stops, { dwellMs: opts?.dwellMs, reducedMotion });
          for (const step of plan.steps) {
            const run = (): void => {
              highlightRef.current = { set: new Set(step.highlight), color: HIGHLIGHT_STYLE_COLOR.trace };
              frameAddresses([step.focus]);
              requestRender();
            };
            if (step.startMs === 0) run();
            else replayTimersRef.current.push(setTimeout(run, step.startMs));
          }
        },
        // FR-50: expose the FR-47 camera + FR-48 movie to the action palette. These
        // delegate to the SAME local functions the bottom-right controls and the
        // "Play tour" trigger call — single source of truth, no behaviour fork.
        resetCamera() {
          cam.reset();
        },
        fitCamera() {
          cam.fit();
        },
        playTour() {
          playMovieFocus();
        },
      };
      if (cbRef.current.controllerRef) cbRef.current.controllerRef.current = controller;

      // E2E hooks (dev only — `process.env.NODE_ENV` is statically "production" in
      // the static export, so these are tree-shaken from shipped builds like the 2D
      // __sigma hook). See lib/surface-dev-hooks-3d for the shapes; tests assert the
      // 3D tint / drive the controller / read the camera / drive movie mode here
      // without pixel-sampling WebGL.
      if (process.env.NODE_ENV !== "production") {
        installSurface3DDevHooks(container, {
          overlay: (address) => (indexOf.has(address) ? (drawColorOf(address) ?? null) : null),
          // FR-65a: the painted RGB (0..1) of a directed edge, read live from the
          // colour buffer — lets a test prove a traced edge is green, not just set.
          edgeColor: (from, to) => edges.colorOf(from, to),
          // FR-56: whether a node carries the emerald entry-point ring.
          entry: (address) => entryMarkers.has(address),
          controller,
          cameraState: () => cam.state(),
          movie: {
            play: (a, opts) => moviePlayer.play(a, opts),
            playFocus: playMovieFocus,
            toggle: moviePlayer.toggle,
            next: moviePlayer.next,
            prev: moviePlayer.prev,
            stop: moviePlayer.stop,
            state: () => moviePlayer.state(),
            ids: () => ids.slice(),
            pos: (a) => {
              const i = indexOf.get(a);
              return i == null ? null : { x: pos[i].x, y: pos[i].y, z: pos[i].z };
            },
          },
        });
      }

      const ro = new ResizeObserver(() => {
        resize();
        requestRender();
      });
      ro.observe(container);
      cam.update();
      resize();
      requestRender();

      teardown = (): void => {
        cancelReplay();
        cam.cancelTween();
        moviePlayer.destroy();
        camApiRef.current = null;
        movieApiRef.current = null;
        if (raf) cancelAnimationFrame(raf);
        drawRef.current = null;
        ro.disconnect();
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("contextmenu", onContext);
        sphereGeo.dispose();
        nodeMat.dispose();
        edges.dispose();
        entryMarkers.dispose();
        mesh.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        labelLayer.replaceChildren();
        highlightRef.current = null;
        if (cbRef.current.controllerRef) cbRef.current.controllerRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [props.nodes, props.edges, props.projection]);

  return (
    <div ref={containerRef} data-surface="3d" className="absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-grab active:cursor-grabbing" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />

      {/* FR-48: cinematic movie mode — a "Play tour" trigger when a node is selected,
          and a transport bar (prev / play-pause / next / readout / close) while a
          fly-through runs. Bottom-centre, clear of the camera cluster + legend. */}
      <MovieControls3D
        state={movie}
        canPlay={props.selected != null}
        onPlayFocus={() => movieApiRef.current?.playFocus()}
        onToggle={() => movieApiRef.current?.toggle()}
        onNext={() => movieApiRef.current?.next()}
        onPrev={() => movieApiRef.current?.prev()}
        onStop={() => movieApiRef.current?.stop()}
      />

      {/* FR-47: on-canvas camera affordance — discoverable Fit / Reset + a gesture
          hint, bottom-right so it clears the bottom-left kind legend. */}
      <div className="pointer-events-none absolute bottom-4 right-4 flex select-none flex-col items-end gap-2">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#14161c]/90 p-1 shadow-lg shadow-black/40 backdrop-blur">
          <button
            type="button"
            onClick={() => camApiRef.current?.fit()}
            aria-label="Fit graph to view"
            title="Fit graph to view"
            className="inline-flex size-7 items-center justify-center rounded-md text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-400"
          >
            <Maximize size={15} />
          </button>
          <button
            type="button"
            onClick={() => camApiRef.current?.reset()}
            aria-label="Reset camera view"
            title="Reset camera view"
            className="inline-flex size-7 items-center justify-center rounded-md text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-400"
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="pointer-events-none flex items-center gap-1.5 rounded-md border border-white/5 bg-[#14161c]/75 px-2 py-1 text-[10px] font-medium leading-none tracking-wide text-white/45 backdrop-blur">
          <Orbit size={12} />
          <span>drag orbit · shift-drag pan · scroll zoom</span>
        </div>
      </div>
    </div>
  );
}
