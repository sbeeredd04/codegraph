// 3D entry-point markers (FR-56 parity on the 3D surface). The detail panel badges
// a node detected as a likely entry point (pure-core detectEntryPoints) with an
// emerald "start here" marker; this gives the 3D board the matching cue so the
// place execution begins is identifiable at a glance, without opening the panel.
//
// Rendered as a billboarded RING (a camera-facing Sprite, so it always reads as a
// ring from any orbit) drawn OUTSIDE the node sphere — a persistent outline that
// coexists with the fill lenses (highlight / mark / trace / group / kind) rather
// than overriding them. Extracted to its own module so graph-canvas-3d.tsx stays
// under the file-size cap. The ring texture is a 2D-canvas annulus (no eval), so it
// boots under the strict webview nonce CSP (graph3d-csp-smoke).

import type * as ThreeNS from "three";
import type { GraphNode, GraphEdge } from "@core/graph/types";
import { detectEntryPoints } from "@core/graph/entry-point";

// emerald-300 — matches the detail-panel entry badge icon, and a shade brighter
// than the trace tint (emerald-400 #34d399) so a ring + a trace fill stay legible
// together on the same node.
const ENTRY_EMERALD = "#6ee7b7";

export interface EntryMarkers3D {
  /** The group of ring sprites to add to the scene. */
  readonly object: ThreeNS.Object3D;
  /** Whether an address carries an entry marker (dev/e2e hook). */
  has(address: string): boolean;
  /** Release the GPU buffers on teardown. */
  dispose(): void;
}

export interface EntryMarkersInput {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Address → instance index in the rendered scene. */
  readonly indexOf: Map<string, number>;
  /** World positions, indexed like the scene (x/y/z; a Vector3 satisfies this). */
  readonly positions: ReadonlyArray<{ x: number; y: number; z: number }>;
  /** Per-node render metadata, indexed like the scene — `size` drives the ring radius. */
  readonly meta: ReadonlyArray<{ size: number }>;
}

/**
 * Detect the graph's entry points (pure core) and build an emerald ring for each
 * one present in the rendered projection. Entry points filtered out of the current
 * projection (no position) are silently skipped.
 */
export function buildEntryMarkers3D(THREE: typeof ThreeNS, input: EntryMarkersInput): EntryMarkers3D {
  const entries = new Set(detectEntryPoints(input.nodes, input.edges).map((e) => e.address));
  const group = new THREE.Group();
  group.renderOrder = 2; // over the spheres
  const has = (a: string): boolean => entries.has(a) && input.indexOf.has(a);
  if (entries.size === 0) {
    return { object: group, has, dispose: () => {} };
  }

  const texture = makeRingTexture(THREE);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false, // a marker overlay: respect depth, don't occlude later draws
    fog: false, // a wayfinding marker stays full-emerald regardless of depth cueing
  });

  for (const id of entries) {
    const i = input.indexOf.get(id);
    if (i == null) continue; // detected on the full graph; not in this projection
    const p = input.positions[i];
    const sprite = new THREE.Sprite(material);
    sprite.position.set(p.x, p.y, p.z);
    // Sized to sit OUTSIDE the node sphere (which grows on focus/hover by up to
    // ~0.9), so the ring never collides with the fill.
    const s = (0.7 + input.meta[i].size * 0.16 + 1.1) * 3.0;
    sprite.scale.set(s, s, 1);
    group.add(sprite);
  }

  return {
    object: group,
    has,
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}

/** A transparent canvas with a stroked emerald annulus — the ring sprite's map. */
function makeRingTexture(THREE: typeof ThreeNS): ThreeNS.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    // a soft outer glow so the ring reads against busy fog/depth, then the crisp ring
    ctx.strokeStyle = "rgba(110, 231, 183, 0.28)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(c, c, c - 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = ENTRY_EMERALD;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(c, c, c - 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
