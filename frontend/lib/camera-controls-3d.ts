// 3D camera controller (FR-47). A built-once handle — the sibling of lib/edges-3d
// and lib/entry-markers-3d — that owns the PerspectiveCamera and the orbit pose
// (spherical radius/theta/phi around a pannable target), plus the eased tween that
// Reset / Fit / node-framing / FR-48 movie stops all share. Extracted from
// graph-canvas-3d.tsx to keep that file under the size cap; the math is unchanged
// (guarded by explorer-camera3d.spec.ts) so behaviour is identical.
//
// Division of labour: this module owns camera-MATRIX correctness (every mutator
// calls update() internally); the component owns WHEN to paint — it passes a
// coalesced `requestRender` (used after manual input + on tween settle) and a
// direct `drawFrame` (render + labels, no overlay recompute) for tween steps.

import type * as ThreeNS from "three";

const FOV = 52;
const NEAR = 0.1;
const FAR = 6000;
const PHI_MIN = 0.12;
const PHI_MAX = Math.PI - 0.12;
const CAM_TWEEN_MS = 520; // ease duration for Reset / Fit / node-to-node framing
// Default camera pose — a pleasant 3/4 orbit; Reset returns here. Expressed as
// multiples of the world radius so it scales with the layout.
const DEFAULT_RADIUS_MUL = 2.6;
const DEFAULT_THETA = 0.7; // azimuth
const DEFAULT_PHI = 1.15; // polar from +Y
const ZOOM_MIN_MUL = 0.8; // closest orbit distance, * world
const ZOOM_MAX_MUL = 7.5; // farthest orbit distance, * world

/** A partial goal pose for a tween — any omitted field holds its current value. */
export interface CameraGoal {
  radius?: number;
  theta?: number;
  phi?: number;
  tx?: number;
  ty?: number;
  tz?: number;
}

export interface CameraControls3D {
  /** The owned perspective camera (passed to renderer.render / raycaster). */
  readonly camera: ThreeNS.PerspectiveCamera;
  /** Current spherical pose + target — for the __cameraState dev hook. */
  state(): { radius: number; theta: number; phi: number; tx: number; ty: number; tz: number };
  /** Recompute the camera matrix from the current radius/theta/phi/target. */
  update(): void;
  /** Project a world point to screen px (labels + nearest-node hit-test fallback). */
  projectToScreen(v: ThreeNS.Vector3): { x: number; y: number; z: number };
  /** Orbit by screen-pixel deltas (no-modifier drag). Updates the matrix. */
  orbit(dx: number, dy: number): void;
  /** Pan the target by screen-pixel deltas (shift/right/middle-drag). */
  pan(dx: number, dy: number): void;
  /** Zoom by a wheel delta, clamped to the world bounds. */
  zoom(deltaY: number): void;
  /** Re-read the aspect from the live viewport. */
  resize(): void;
  /** Eased fly to a partial goal pose (instant under reduced motion / ms<=0). */
  tweenTo(goal: CameraGoal, ms?: number): void;
  /** Cancel an in-flight tween so manual input never fights the camera. */
  cancelTween(): void;
  /** Return to the default 3/4 pose (angle + zoom + centre). */
  reset(): void;
  /** Reframe the whole graph from the CURRENT orbit angle (enclose the sphere). */
  fit(): void;
  /** Pan so a set of world positions' centroid sits centre (no zoom change). */
  frame(positions: readonly ThreeNS.Vector3[]): void;
}

export interface CameraControls3DOpts {
  /** Layout radius in world units — drives default distance + zoom/fit bounds. */
  readonly world: number;
  readonly widthOf: () => number;
  readonly heightOf: () => number;
  /** Coalesced on-demand render (used after manual input + on tween settle). */
  readonly requestRender: () => void;
  /** Direct per-frame draw for tween steps: render scene + project labels, but
   *  skip the overlay recompute (tints don't change while only the camera moves). */
  readonly drawFrame: () => void;
  readonly prefersReducedMotion: () => boolean;
}

export function buildCameraControls3D(
  THREE: typeof ThreeNS,
  opts: CameraControls3DOpts,
): CameraControls3D {
  const { world, widthOf, heightOf, requestRender, drawFrame, prefersReducedMotion } = opts;
  const camera = new THREE.PerspectiveCamera(FOV, widthOf() / heightOf(), NEAR, FAR);

  const target = new THREE.Vector3(0, 0, 0);
  let radius = world * DEFAULT_RADIUS_MUL;
  let theta = DEFAULT_THETA;
  let phi = DEFAULT_PHI;

  const update = (): void => {
    const sinPhi = Math.sin(phi);
    camera.position.set(
      target.x + radius * sinPhi * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * sinPhi * Math.cos(theta),
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
  };

  const tmpVec = new THREE.Vector3();
  const projectToScreen = (v: ThreeNS.Vector3): { x: number; y: number; z: number } => {
    tmpVec.copy(v).project(camera);
    return {
      x: (tmpVec.x * 0.5 + 0.5) * widthOf(),
      y: (-tmpVec.y * 0.5 + 0.5) * heightOf(),
      z: tmpVec.z,
    };
  };

  const orbit = (dx: number, dy: number): void => {
    theta -= dx * 0.005;
    phi = Math.min(PHI_MAX, Math.max(PHI_MIN, phi - dy * 0.005));
    update();
  };

  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const pan = (dx: number, dy: number): void => {
    const k = radius * 0.0016;
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    target.addScaledVector(camRight, -dx * k).addScaledVector(camUp, dy * k);
    update();
  };

  const zoom = (deltaY: number): void => {
    radius = Math.min(world * ZOOM_MAX_MUL, Math.max(world * ZOOM_MIN_MUL, radius * Math.exp(deltaY * 0.0012)));
    update();
  };

  const resize = (): void => {
    camera.aspect = widthOf() / heightOf();
    camera.updateProjectionMatrix();
  };

  const easeInOut = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  let tweenRaf = 0;
  const cancelTween = (): void => {
    if (tweenRaf) {
      cancelAnimationFrame(tweenRaf);
      tweenRaf = 0;
    }
  };
  const tweenTo = (goal: CameraGoal, ms = CAM_TWEEN_MS): void => {
    cancelTween();
    const from = { radius, theta, phi, tx: target.x, ty: target.y, tz: target.z };
    let dTheta = (goal.theta ?? theta) - theta; // shortest-arc azimuth
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    const to = {
      radius: goal.radius ?? from.radius,
      theta: from.theta + dTheta,
      phi: goal.phi ?? from.phi,
      tx: goal.tx ?? from.tx,
      ty: goal.ty ?? from.ty,
      tz: goal.tz ?? from.tz,
    };
    const settle = (): void => {
      radius = to.radius;
      theta = to.theta;
      phi = to.phi;
      target.set(to.tx, to.ty, to.tz);
      update();
      requestRender();
    };
    if (ms <= 0 || prefersReducedMotion()) {
      settle();
      return;
    }
    const start = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / ms);
      const e = easeInOut(t);
      radius = from.radius + (to.radius - from.radius) * e;
      theta = from.theta + (to.theta - from.theta) * e;
      phi = from.phi + (to.phi - from.phi) * e;
      target.set(
        from.tx + (to.tx - from.tx) * e,
        from.ty + (to.ty - from.ty) * e,
        from.tz + (to.tz - from.tz) * e,
      );
      update();
      drawFrame();
      tweenRaf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    tweenRaf = requestAnimationFrame(step);
  };

  const reset = (): void => {
    tweenTo({ radius: world * DEFAULT_RADIUS_MUL, theta: DEFAULT_THETA, phi: DEFAULT_PHI, tx: 0, ty: 0, tz: 0 });
  };
  const fit = (): void => {
    const halfV = ((camera.fov * Math.PI) / 180) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const fitDist = (world / Math.sin(Math.min(halfV, halfH))) * 1.12;
    tweenTo({ radius: fitDist, tx: 0, ty: 0, tz: 0 });
  };
  const frame = (positions: readonly ThreeNS.Vector3[]): void => {
    if (positions.length === 0) return;
    const c = new THREE.Vector3();
    for (const p of positions) c.add(p);
    c.multiplyScalar(1 / positions.length);
    tweenTo({ tx: c.x, ty: c.y, tz: c.z }, 420); // smooth fly-to, no zoom change
  };

  return {
    camera,
    state: () => ({ radius, theta, phi, tx: target.x, ty: target.y, tz: target.z }),
    update,
    projectToScreen,
    orbit,
    pan,
    zoom,
    resize,
    tweenTo,
    cancelTween,
    reset,
    fit,
    frame,
  };
}
