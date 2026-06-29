// Minimal ambient types for d3-force-3d (FR-46). The package ships no .d.ts and
// has no @types entry; this declares only the surface the 3D graph surface uses
// (a 3-dimensional force simulation: charge + link + centring), typed enough for
// strict tsc. d3-force-3d mirrors d3-force's API with x/y/z (+ vx/vy/vz) added and
// a `numDimensions` arg on forceSimulation. Its default random source is a
// deterministic LCG, so layouts are reproducible across reloads (resume-safe).

declare module "d3-force-3d" {
  export interface SimulationNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface Force<N> {
    (alpha: number): void;
    initialize?(nodes: N[], random: () => number, numDimensions: number): void;
  }

  export interface Simulation<N extends SimulationNode> {
    tick(iterations?: number): this;
    stop(): this;
    restart(): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaDecay(decay: number): this;
    alphaMin(min: number): this;
    velocityDecay(decay: number): this;
    numDimensions(n: number): this;
    randomSource(source: () => number): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
  }

  export function forceSimulation<N extends SimulationNode>(
    nodes?: N[],
    numDimensions?: number,
  ): Simulation<N>;

  export interface ManyBodyForce<N> extends Force<N> {
    strength(strength: number | ((node: N, i: number, nodes: N[]) => number)): this;
    distanceMin(distance: number): this;
    distanceMax(distance: number): this;
    theta(theta: number): this;
  }
  export function forceManyBody<N extends SimulationNode>(): ManyBodyForce<N>;

  export interface LinkForce<N, L> extends Force<N> {
    links(): L[];
    links(links: L[]): this;
    id(id: (node: N, i: number, nodes: N[]) => string): this;
    distance(distance: number | ((link: L, i: number, links: L[]) => number)): this;
    strength(strength: number | ((link: L, i: number, links: L[]) => number)): this;
    iterations(iterations: number): this;
  }
  export function forceLink<N extends SimulationNode, L>(links?: L[]): LinkForce<N, L>;

  export interface CenterForce<N> extends Force<N> {
    x(x: number): this;
    y(y: number): this;
    z(z: number): this;
    strength(strength: number): this;
  }
  export function forceCenter<N extends SimulationNode>(x?: number, y?: number, z?: number): CenterForce<N>;

  export interface CollideForce<N> extends Force<N> {
    radius(radius: number | ((node: N, i: number, nodes: N[]) => number)): this;
    strength(strength: number): this;
    iterations(iterations: number): this;
  }
  export function forceCollide<N extends SimulationNode>(
    radius?: number | ((node: N, i: number, nodes: N[]) => number),
  ): CollideForce<N>;
}
