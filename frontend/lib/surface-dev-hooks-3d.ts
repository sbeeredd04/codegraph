// Dev-only e2e hooks for the 3D surface. Attached to the surface container so
// Playwright can assert overlay tint / drive the controller / read the camera /
// drive movie mode WITHOUT pixel-sampling WebGL. Callers guard on
// `process.env.NODE_ENV !== "production"`, which is statically false in the static
// export, so this whole surface area is tree-shaken from shipped builds (like the
// 2D __sigma hook). Kept out of the component to hold it under the file-size cap.

import type { SurfaceController } from "./surface-controller";
import type { MovieOptions, MovieState } from "./movie-player-3d";

export interface CameraSnapshot {
  radius: number;
  theta: number;
  phi: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface MovieDevHook {
  play: (addresses: readonly string[], opts?: MovieOptions) => void;
  playFocus: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  state: () => MovieState;
  /** Deterministic node ids (the layout order) — a stable path source for tests. */
  ids: () => string[];
  /** A node's world position — the expected camera target after framing it. */
  pos: (address: string) => { x: number; y: number; z: number } | null;
}

export interface Surface3DDevHooks {
  /** FR-37: a node's overlay-resolved draw colour (null if absent). */
  overlay: (address: string) => string | null;
  /** FR-65a: a directed edge's painted RGB (0..1), or null if no such edge. */
  edgeColor: (from: string, to: string) => { r: number; g: number; b: number } | null;
  /** FR-40: the surface controller, for the guided-tour parity test. */
  controller: SurfaceController;
  /** FR-47: the camera pose, for Reset/Fit assertions. */
  cameraState: () => CameraSnapshot;
  /** FR-48: the movie player, for fly-through assertions. */
  movie: MovieDevHook;
}

interface HookCarrier {
  __overlay3d?: Surface3DDevHooks["overlay"];
  __edge3d?: Surface3DDevHooks["edgeColor"];
  __controller?: SurfaceController;
  __cameraState?: () => CameraSnapshot;
  __movie?: MovieDevHook;
}

export function installSurface3DDevHooks(container: HTMLElement, hooks: Surface3DDevHooks): void {
  const carrier = container as unknown as HookCarrier;
  carrier.__overlay3d = hooks.overlay;
  carrier.__edge3d = hooks.edgeColor;
  carrier.__controller = hooks.controller;
  carrier.__cameraState = hooks.cameraState;
  carrier.__movie = hooks.movie;
}
