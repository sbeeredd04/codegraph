// 3D edge rendering (extracted from graph-canvas-3d to hold it under the file-size
// cap). One THREE.LineSegments carries every edge with per-vertex colour; the
// geometry is built ONCE (edges don't move after layout) and only the colours
// recompute as the focus / trace lens changes. Mirrors the 2D path lens: the
// manual-trace route tints trace-green (FR-65a) and wins over the focus-violet
// (FR-25), while off-lens edges dim — so a deliberate trail reads as one lit path.

import type * as ThreeNS from "three";
import { pathEdgeKey } from "@core/graph/path";
import type { FocusHighlight } from "@core/graph/focus";

const EDGE_BASE = 0x94a1c8; // resting edge tone — lifted from a near-invisible slate so
// connections actually read against the dark field (owner: "edges are not visible")
const EDGE_FOCUS = 0xa78bfa; // brand-violet focus edge (FR-25)

export interface Edges3D {
  /** The LineSegments to add to the scene. */
  readonly object: ThreeNS.LineSegments;
  /** Recompute every edge's colour from the live focus + trace lens. */
  apply(focus: FocusHighlight | null, traceEdges: ReadonlySet<string> | null): void;
  /** The painted RGB (0..1) of a directed edge, or null if absent (dev/e2e hook). */
  colorOf(from: string, to: string): { r: number; g: number; b: number } | null;
  /** Release the GPU buffers on teardown. */
  dispose(): void;
}

/**
 * Build the edge layer. `posOf` resolves a node address to its world position
 * (the layout the node mesh shares); `traceColorHex` is the trace tint, passed in
 * so it stays identical to the node trace colour (single source of truth).
 */
export function buildEdges3D(
  THREE: typeof ThreeNS,
  edgePairs: readonly (readonly [string, string])[],
  posOf: (id: string) => { x: number; y: number; z: number } | undefined,
  traceColorHex: string,
): Edges3D {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(edgePairs.length * 6);
  const colors = new Float32Array(edgePairs.length * 6);
  // pathEdgeKey → edge index, so colorOf can read a specific edge without pixel-
  // sampling WebGL.
  const indexOf = new Map<string, number>();
  for (let i = 0; i < edgePairs.length; i++) {
    const a = posOf(edgePairs[i][0]);
    const b = posOf(edgePairs[i][1]);
    if (a && b) positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    indexOf.set(pathEdgeKey(edgePairs[i][0], edgePairs[i][1]), i);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
  const object = new THREE.LineSegments(geo, material);
  object.frustumCulled = false;

  const colBase = new THREE.Color(EDGE_BASE);
  const colFocus = new THREE.Color(EDGE_FOCUS);
  const colTrace = new THREE.Color(traceColorHex);

  const apply = (focus: FocusHighlight | null, traceEdges: ReadonlySet<string> | null): void => {
    const lensActive = focus != null || (traceEdges != null && traceEdges.size > 0);
    for (let i = 0; i < edgePairs.length; i++) {
      const key = pathEdgeKey(edgePairs[i][0], edgePairs[i][1]);
      const isTrace = traceEdges ? traceEdges.has(key) : false;
      // Trace-green beats focus-violet (a deliberate route beats the lens), mirroring
      // the node precedence trace > group > kind.
      const isFocus = !isTrace && focus ? focus.edges.has(key) : false;
      const c = isTrace ? colTrace : isFocus ? colFocus : colBase;
      // At rest edges sit bright enough to trace by eye (0.6 → 0.92); once a lens is
      // armed the off-lens edges recede a touch harder (0.18 → 0.22) so the lit path
      // still wins, but the whole field never goes invisible again.
      const f = isTrace || isFocus ? 1 : lensActive ? 0.22 : 0.92;
      const o = i * 6;
      colors[o] = c.r * f;
      colors[o + 1] = c.g * f;
      colors[o + 2] = c.b * f;
      colors[o + 3] = c.r * f;
      colors[o + 4] = c.g * f;
      colors[o + 5] = c.b * f;
    }
    geo.attributes.color.needsUpdate = true;
  };

  const colorOf = (from: string, to: string): { r: number; g: number; b: number } | null => {
    const i = indexOf.get(pathEdgeKey(from, to));
    if (i == null) return null;
    const o = i * 6;
    return { r: colors[o], g: colors[o + 1], b: colors[o + 2] };
  };

  const dispose = (): void => {
    geo.dispose();
    material.dispose();
  };

  return { object, apply, colorOf, dispose };
}
