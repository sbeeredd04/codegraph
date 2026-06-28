// 3D layout + orthographic camera math for the explorer's 3D render mode (FR-17).
//
// Pure (no DOM, no WebGL, no clock/RNG) so it is unit-tested in isolation and
// shared with the frontend 3D canvas via @adapters — the "swappable render
// adapter over the same projection" seam (AD-15): the 2D and 3D surfaces consume
// ONE projected graph + the same render model; only the rendering substrate and
// the camera differ. Keeping the trig here, behind tests, is what lets the 3D
// canvas stay a thin imperative shell.

import type { NodeKind } from "../../../core/graph/types.js";

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Projected {
  readonly x: number;
  readonly y: number;
  /**
   * Camera-space depth after rotation; higher = nearer the viewer. Used for
   * z-ordering (draw far first) and depth cueing (shrink/fade far nodes).
   */
  readonly depth: number;
}

// Kind → depth band in [-1, 1]: modules sit at the back, classes/workflows mid,
// callables toward the front, so the structural hierarchy reads as layers in 3D.
const KIND_BAND: Record<NodeKind, number> = {
  module: -1,
  class: -0.25,
  workflow: -0.25,
  function: 0.4,
  method: 0.9,
};

export interface LiftInput {
  readonly id: string;
  readonly kind: NodeKind;
  readonly x: number;
  readonly y: number;
}

/**
 * Lift a 2D layout into 3D: keep each node's (x, y) and add a z from its kind
 * band, scaled to the layout's own spread so the depth axis is commensurate with
 * the plane (a small graph gets a shallow box, a wide one a deep box). A tiny
 * deterministic per-node jitter (hash of id) keeps same-kind nodes off a single
 * plane. No randomness — identical input yields identical output (resume-safe).
 */
export function lift3d(nodes: readonly LiftInput[]): Map<string, Point3> {
  const span = layoutSpan(nodes);
  const depth = span * 0.6; // how deep the 3D box is, relative to its width
  const out = new Map<string, Point3>();
  for (const n of nodes) {
    const band = KIND_BAND[n.kind] ?? 0;
    const jitter = (hash01(n.id) - 0.5) * 0.18; // ±0.09 band-units of separation
    out.set(n.id, { x: n.x, y: n.y, z: (band + jitter) * depth });
  }
  return out;
}

/** Characteristic width of the x/y point cloud (the larger of its two extents). */
function layoutSpan(nodes: readonly LiftInput[]): number {
  if (nodes.length === 0) return 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  return span > 0 ? span : 1;
}

/** Deterministic 0..1 hash of a string (FNV-1a), for stable per-node jitter. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Orthographic projection of a 3D point after a yaw (around the vertical Y axis)
 * then pitch (around the horizontal X axis) rotation. Returns the on-plane (x, y)
 * and a camera-space depth for ordering / cueing. Pure trig.
 */
export function project3d(p: Point3, yaw: number, pitch: number): Projected {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // Rotate around Y: x and z mix, y is unchanged.
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rotate around X: y and z1 mix.
  const y1 = p.y * cp - z1 * sp;
  const depth = p.y * sp + z1 * cp;
  return { x: x1, y: y1, depth };
}

/**
 * Nearest node to a point in projected (screen) space, within maxDist. Used for
 * hover/click hit-testing in the 3D canvas. Ties go to the later candidate, so a
 * caller that passes nodes ordered far→near gets the nearer-to-camera hit on top.
 * Returns null when nothing is within range.
 */
export function nearestNode(
  points: readonly { readonly id: string; readonly x: number; readonly y: number }[],
  px: number,
  py: number,
  maxDist: number,
): string | null {
  let best: string | null = null;
  let bestD2 = maxDist * maxDist;
  for (const pt of points) {
    const dx = pt.x - px;
    const dy = pt.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = pt.id;
    }
  }
  return best;
}
