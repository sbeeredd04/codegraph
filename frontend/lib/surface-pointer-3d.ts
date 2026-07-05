// 3D pointer/interaction controller (FR-46 / FR-71 / FR-61). A built-once handle — the
// sibling of lib/camera-controls-3d and lib/surface-movie-3d — that owns the canvas
// pointer concern: drag = orbit, shift/right/middle-drag = pan, wheel = zoom, click =
// select (or peek on ctrl/⌘, or extend the manual trace while the trace tool is armed),
// hover = highlight. It also owns hit-testing (raycast the instanced spheres, then a
// forgiving 14px screen-space nearest fallback so small distant nodes stay clickable).
// Extracted from graph-canvas-3d.tsx to keep that file under the size cap; every
// gesture is unchanged (guarded by explorer-3d + the explorer-trace 3D-carry e2e) so
// behaviour is identical. Drives the VIEW only — never touches source files (FR-9).
//
// Division of labour: the camera MATH lives in cam.* (lib/camera-controls-3d); this
// only translates pointer deltas into cam calls and picks. `hoverId` is shared with the
// component's draw loop (applyOverlays / renderLabels read it), so it's bridged through
// getHover/setHover accessors rather than owned here — one source of truth, no copy.

import type * as ThreeNS from "three";
import type { CameraControls3D } from "./camera-controls-3d";

/** The narrow slice of the surface props the pointer handlers read live — kept minimal
 *  (and structural) so this module doesn't depend on the whole GraphSurfaceProps bag.
 *  `cb()` returns the CURRENT props each gesture, so a re-render's new callbacks win. */
export interface PointerCallbacks {
  /** FR-61: while armed, a click extends the manual trace instead of selecting. */
  readonly traceArmed?: boolean;
  onHoverNode(address: string | null): void;
  onSelectNode(address: string): void;
  onClearSelection(): void;
  /** FR-71: ctrl/⌘-click peeks a node's connections without selecting it. */
  onPeekNode?(address: string): void;
  /** FR-61: a trace-armed click forwards the target to the Explorer's trace model. */
  onTraceClick?(address: string): void;
}

export interface PointerControls3DOpts {
  readonly canvas: HTMLCanvasElement;
  /** The camera controller — for cancelTween, orbit/pan/zoom, projectToScreen + camera. */
  readonly cam: CameraControls3D;
  /** The instanced node mesh — the raycast target. */
  readonly mesh: ThreeNS.InstancedMesh;
  /** Node addresses, index-aligned with `positions`. */
  readonly ids: readonly string[];
  /** World positions, index-aligned with `ids` (for the nearest-node fallback). */
  readonly positions: readonly ThreeNS.Vector3[];
  readonly widthOf: () => number;
  readonly heightOf: () => number;
  /** Coalesced on-demand render (after orbit/pan/zoom/hover change). */
  readonly requestRender: () => void;
  /** End an in-flight FR-48 movie — grabbing the canvas (orbit/pan/pick) preempts it. */
  readonly stopMovie: () => void;
  /** Read the live hover id (owned by the component's draw loop). */
  readonly getHover: () => string | null;
  /** Write the live hover id (the component's draw loop reads it back). */
  readonly setHover: (address: string | null) => void;
  /** The current surface props — read live each gesture. */
  readonly cb: () => PointerCallbacks;
}

export interface PointerControls3D {
  /** Wire the canvas pointer/wheel/context listeners. */
  attach(): void;
  /** Remove every listener this handle added (mirror of attach). */
  detach(): void;
}

export function buildPointerControls3D(
  THREE: typeof ThreeNS,
  opts: PointerControls3DOpts,
): PointerControls3D {
  const { canvas, cam, mesh, ids, positions, widthOf, heightOf, requestRender, stopMovie, getHover, setHover, cb } = opts;

  // Hit-testing: raycast the instanced spheres first, then a forgiving 14px screen-space
  // nearest fallback so small distant nodes stay clickable.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickAt = (mx: number, my: number): string | null => {
    ndc.set((mx / widthOf()) * 2 - 1, -(my / heightOf()) * 2 + 1);
    raycaster.setFromCamera(ndc, cam.camera);
    const hits = raycaster.intersectObject(mesh);
    if (hits.length && hits[0].instanceId != null) return ids[hits[0].instanceId];
    let best: string | null = null;
    let bestD2 = 14 * 14;
    for (let i = 0; i < ids.length; i++) {
      const sp = cam.projectToScreen(positions[i]);
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

  // drag = orbit; shift/right/middle-drag = pan; wheel = zoom; click = select; hover =
  // highlight. The camera math itself lives in the FR-47 controller (cam.*).
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
    stopMovie(); // grabbing the canvas (orbit/pan or a new pick) ends a movie
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
    if (hit !== getHover()) {
      setHover(hit);
      cb().onHoverNode(hit);
      requestRender();
    }
  };
  const onUp = (e: PointerEvent): void => {
    if (dragging && moved < 4) {
      const { mx, my } = localXY(e);
      const hit = pickAt(mx, my);
      // FR-61: a click while the trace tool is armed extends the manual trace
      // (forwarded to the Explorer) instead of selecting — same as the 2D surface.
      // FR-71: ctrl/⌘-click peeks the node's connections without selecting it —
      // parity with the 2D surface's modifier-click.
      const props = cb();
      if (hit) {
        if (props.traceArmed) props.onTraceClick?.(hit);
        else if (e.ctrlKey || e.metaKey) props.onPeekNode?.(hit);
        else props.onSelectNode(hit);
      } else props.onClearSelection();
    }
    dragging = false;
    panning = false;
  };
  const onLeave = (): void => {
    if (getHover()) {
      setHover(null);
      cb().onHoverNode(null);
      requestRender();
    }
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    cam.cancelTween(); // manual zoom preempts an in-flight camera tween
    stopMovie(); // manual zoom ends a movie
    cam.zoom(e.deltaY);
    requestRender();
  };
  const onContext = (e: Event): void => e.preventDefault();

  return {
    attach(): void {
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("contextmenu", onContext);
    },
    detach(): void {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
    },
  };
}
