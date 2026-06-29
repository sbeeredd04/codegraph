// Surface-side wiring for FR-48 movie mode. Adapts the substrate-agnostic player
// (movie-player-3d.ts) to the 3D surface's primitives and adds the user-facing
// "play the selected node's neighbourhood" trigger. Lives outside the component to
// keep graph-canvas-3d.tsx under the file-size cap and to gather all movie
// integration in one place.

import { createMoviePlayer, type MoviePlayer } from "./movie-player-3d";
import { HIGHLIGHT_STYLE_COLOR } from "./overlay-style";

export interface SurfaceMovieDeps {
  /** Resolve an address to world position + label, or null if absent. */
  resolve: (address: string) => { x: number; y: number; z: number; label: string } | null;
  /** Fly the camera to frame a world point (close-up); ms<=0 / reduced motion snaps. */
  flyTo: (point: { x: number; y: number; z: number }, ms: number) => void;
  /** Apply (or clear) the transient trace highlight for the current stop. */
  setHighlight: (highlight: { set: ReadonlySet<string>; color: string } | null) => void;
  prefersReducedMotion: () => boolean;
  /** Push live player state to the React transport bar. */
  publish: (state: import("./movie-player-3d").MovieState) => void;
  /** Cancel any in-flight agent guided tour (mutually exclusive with a movie). */
  cancelAgentTour: () => void;
  /** The ordered path for the "play focus" trigger — centre then its neighbours. */
  focusPath: () => string[];
}

export interface SurfaceMovie {
  player: MoviePlayer;
  /** Start a fly-through of the selected node's neighbourhood. */
  playFocus: () => void;
}

/** The subset the React transport bar drives (published via a ref). */
export interface MovieControlsApi {
  playFocus: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

export function createSurfaceMovie(deps: SurfaceMovieDeps): SurfaceMovie {
  const player = createMoviePlayer({
    resolve: deps.resolve,
    flyTo: deps.flyTo,
    setHighlight: (addresses) =>
      deps.setHighlight(
        addresses && addresses.length
          ? { set: new Set(addresses), color: HIGHLIGHT_STYLE_COLOR.trace }
          : null,
      ),
    prefersReducedMotion: deps.prefersReducedMotion,
    publish: deps.publish,
    cancelAgentTour: deps.cancelAgentTour,
  });
  return {
    player,
    playFocus: () => player.play(deps.focusPath()),
  };
}
