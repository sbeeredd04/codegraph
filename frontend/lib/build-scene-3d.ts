// Scene-model build for the 3D surface (FR-46). Pure data-in / model-out: takes the
// graph + projection (same projection + render model as the 2D surface) and the
// d3-force-3d primitives, runs a TRUE 3D force-directed layout, and returns node
// metadata, deduped undirected edge pairs, and positions normalised to a WORLD-unit
// sphere (so camera framing is graph-size-independent). Holds no three.js / WebGL —
// positions are plain {x,y,z} the renderer wraps in Vector3 — and keeps
// graph-canvas-3d.tsx under the file-size cap.

import { projectGraph } from "@core/graph/projection";
import { buildRenderModel, findOrphanAddresses } from "@adapters/surfaces/webview/render-model";

type GraphNodes = Parameters<typeof projectGraph>[0];
type GraphEdges = Parameters<typeof projectGraph>[1];
type Projection = Parameters<typeof projectGraph>[2];
type D3Force3D = typeof import("d3-force-3d");
export type SceneForces = Pick<
  D3Force3D,
  "forceSimulation" | "forceManyBody" | "forceLink" | "forceCenter" | "forceCollide"
>;

export interface NodeMeta {
  readonly id: string;
  readonly size: number;
  readonly color: string;
  readonly label: string;
}

interface SimNode {
  readonly id: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface Scene3DInput {
  readonly nodes: GraphNodes;
  readonly edges: GraphEdges;
  readonly projection: Projection;
  /** Layout sphere radius in world units. */
  readonly world: number;
}

export interface Scene3DModel {
  readonly ids: string[];
  readonly indexOf: Map<string, number>;
  readonly meta: NodeMeta[];
  readonly metaById: Map<string, NodeMeta>;
  readonly edgePairs: Array<[string, string]>;
  readonly positions: Array<{ x: number; y: number; z: number }>;
  readonly orphanCount: number;
}

export function buildScene3D(input: Scene3DInput, forces: SceneForces): Scene3DModel {
  const { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } = forces;

  const projected = projectGraph(input.nodes, input.edges, input.projection);
  const orphanSet = findOrphanAddresses(input.nodes, input.edges);
  const model = buildRenderModel(
    projected.nodes,
    projected.edges,
    undefined,
    undefined,
    undefined,
    undefined,
    orphanSet,
  );

  const ids = model.nodes.map((n) => n.id);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const meta: NodeMeta[] = model.nodes.map((n) => ({
    id: n.id,
    size: n.size,
    color: n.color,
    label: n.label,
  }));
  const metaById = new Map(meta.map((m) => [m.id, m]));

  // Dedup edges (both endpoints present, no self-loop) — undirected for layout.
  const seen = new Set<string>();
  const edgePairs: Array<[string, string]> = [];
  for (const e of model.edges) {
    if (!indexOf.has(e.source) || !indexOf.has(e.target) || e.source === e.target) continue;
    const k = e.source < e.target ? `${e.source} ${e.target}` : `${e.target} ${e.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edgePairs.push([e.source, e.target]);
  }

  // True 3D force-directed layout (replaces the old kind-band z-projection).
  const simNodes: SimNode[] = ids.map((id) => ({ id }));
  const simLinks = edgePairs.map(([source, target]) => ({ source, target }));
  // Spread the cloud MUCH wider (owner: "move the 3D objects a lot farther"). The key
  // lever under the normalise-to-WORLD step is a big collide floor (a hard local
  // minimum-separation that survives normalisation) plus long, loose links; charge is
  // kept LOCAL (short distanceMax) so it de-clumps neighbours without flinging the
  // disconnected satellite components far enough to shrink the main graph on screen.
  const sim = forceSimulation<SimNode>(simNodes, 3)
    .force("charge", forceManyBody<SimNode>().strength(-58).distanceMax(150))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(46)
        .strength(0.3),
    )
    .force("center", forceCenter<SimNode>(0, 0, 0))
    .force("collide", forceCollide<SimNode>(6.6))
    .stop();
  const iters = Math.min(320, 90 + simNodes.length);
  for (let i = 0; i < iters; i++) sim.tick();
  sim.stop();

  // Normalise the point cloud to a WORLD-unit sphere centred at the origin.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const n of simNodes) {
    cx += n.x ?? 0;
    cy += n.y ?? 0;
    cz += n.z ?? 0;
  }
  const invN = 1 / (simNodes.length || 1);
  cx *= invN;
  cy *= invN;
  cz *= invN;
  // Normalise by a PERCENTILE radius, not the single farthest node. Disconnected
  // satellite components fling far out and, under a max-radius scale, they set the
  // whole size — crushing the main cluster into a tiny dense ball at the centre
  // (owner: "move the objects a lot farther"). Scaling by the 93rd-percentile radius
  // lets the main body fill the WORLD sphere; the few true outliers simply extend a
  // little past it (fog + orbit handle them), so the graph you actually read is spread.
  const radii = simNodes
    .map((n) => Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz))
    .sort((a, b) => a - b);
  const pIdx = Math.floor(0.93 * (radii.length - 1));
  const scaleR = Math.max(1, radii[pIdx] ?? 1);
  const norm = input.world / scaleR;
  const positions = simNodes.map((n) => ({
    x: ((n.x ?? 0) - cx) * norm,
    y: ((n.y ?? 0) - cy) * norm,
    z: ((n.z ?? 0) - cz) * norm,
  }));

  return { ids, indexOf, meta, metaById, edgePairs, positions, orphanCount: model.orphanCount };
}
