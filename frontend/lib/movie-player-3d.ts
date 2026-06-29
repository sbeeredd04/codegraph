// Cinematic movie mode for the 3D surface (FR-48). A small state machine that
// walks an ordered node path and frames each stop in turn "like a movie" — the
// camera flies (the FR-47 tween) to each node, dwells, then advances. It owns no
// three.js / WebGL itself: the surface injects the primitives (resolve a node's
// world position, fly the camera, set the transient highlight, publish state), so
// this module stays render-substrate-agnostic and unit-reasoned in isolation, and
// graph-canvas-3d.tsx stays under the file-size cap.
//
// Accessibility: under prefers-reduced-motion the timeline does NOT auto-step
// (mirrors the FR-40 replay rule). The camera still snaps to each stop, but the
// viewer advances deliberately with the next/prev controls — no motion they didn't
// ask for. Manual orbit/zoom or a new selection cancels an in-flight movie (the
// surface calls stop()), so the human is never fighting the camera.

const DEFAULT_DWELL_MS = 1400; // time lingering on a stop before auto-advancing
const DEFAULT_FLY_MS = 680; // ease duration of the fly between stops

export interface MovieState {
  /** A path is loaded — the transport controls should show. */
  readonly active: boolean;
  /** Auto-advancing through the path right now. */
  readonly playing: boolean;
  /** Reduced-motion: auto-stepping is suppressed; stepping is manual + snapped. */
  readonly reduced: boolean;
  /** Zero-based index of the current stop, or -1 when inactive. */
  readonly index: number;
  /** Total stops in the loaded path. */
  readonly total: number;
  /** Display label of the current stop. */
  readonly label: string;
}

export const INACTIVE_MOVIE: MovieState = {
  active: false,
  playing: false,
  reduced: false,
  index: -1,
  total: 0,
  label: "",
};

export interface MoviePlayerDeps {
  /** Resolve an address to its world position + label, or null if absent. */
  resolve: (address: string) => { x: number; y: number; z: number; label: string } | null;
  /** Fly the camera to frame a world point; ms<=0 (or reduced motion) snaps. */
  flyTo: (point: { x: number; y: number; z: number }, ms: number) => void;
  /** Set (or clear) the transient "look here" highlight for the current stop. */
  setHighlight: (addresses: readonly string[] | null) => void;
  /** Whether the viewer prefers reduced motion (captured at play time). */
  prefersReducedMotion: () => boolean;
  /** Push the latest state to the React transport UI. */
  publish: (state: MovieState) => void;
  /** Cancel any in-flight agent guided tour — movie + tour are mutually exclusive. */
  cancelAgentTour: () => void;
}

export interface MovieOptions {
  readonly dwellMs?: number;
  readonly flyMs?: number;
  /** Start auto-advancing immediately (default true; forced off under reduced motion). */
  readonly autoplay?: boolean;
}

export interface MoviePlayer {
  play: (addresses: readonly string[], opts?: MovieOptions) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  state: () => MovieState;
  destroy: () => void;
}

export function createMoviePlayer(deps: MoviePlayerDeps): MoviePlayer {
  let path: string[] = [];
  let idx = -1;
  let playing = false;
  let reduced = false;
  let dwell = DEFAULT_DWELL_MS;
  let fly = DEFAULT_FLY_MS;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
  };

  const labelAt = (i: number): string =>
    i >= 0 && i < path.length ? (deps.resolve(path[i])?.label ?? "") : "";

  const snapshot = (): MovieState => ({
    active: path.length > 0,
    playing,
    reduced,
    index: idx,
    total: path.length,
    label: labelAt(idx),
  });

  const publish = (): void => deps.publish(snapshot());

  const frame = (i: number): void => {
    const node = deps.resolve(path[i]);
    if (!node) return;
    deps.setHighlight([path[i]]);
    deps.flyTo({ x: node.x, y: node.y, z: node.z }, reduced ? 0 : fly);
  };

  // Advance to `i`, framing it; clamps into range.
  const go = (i: number): void => {
    idx = Math.max(0, Math.min(path.length - 1, i));
    frame(idx);
    publish();
  };

  // Queue the next auto-advance. No-op when paused or under reduced motion.
  const schedule = (): void => {
    clearTimer();
    if (!playing || reduced) return;
    timer = setTimeout(() => {
      timer = 0;
      if (idx + 1 < path.length) {
        idx++;
        frame(idx);
        publish();
        schedule();
      } else {
        playing = false; // reached the end — rest on the final stop
        publish();
      }
    }, dwell + fly);
  };

  return {
    play(addresses, opts) {
      const present = addresses.filter((a) => deps.resolve(a) != null);
      if (present.length === 0) return;
      deps.cancelAgentTour();
      clearTimer();
      path = [...present];
      reduced = deps.prefersReducedMotion();
      dwell = opts?.dwellMs ?? DEFAULT_DWELL_MS;
      fly = opts?.flyMs ?? DEFAULT_FLY_MS;
      playing = (opts?.autoplay ?? true) && !reduced;
      go(0);
      schedule();
    },
    toggle() {
      if (path.length === 0) return;
      if (playing) {
        playing = false;
        clearTimer();
      } else if (!reduced) {
        playing = true;
        if (idx >= path.length - 1) go(0); // replay from the top when at the end
        schedule();
      }
      publish();
    },
    next() {
      if (path.length === 0) return;
      clearTimer();
      if (idx + 1 < path.length) {
        go(idx + 1);
        if (playing) schedule();
      }
    },
    prev() {
      if (path.length === 0) return;
      clearTimer();
      if (idx > 0) {
        go(idx - 1);
        if (playing) schedule();
      }
    },
    stop() {
      if (path.length === 0) return;
      clearTimer();
      path = [];
      idx = -1;
      playing = false;
      deps.setHighlight(null);
      publish();
    },
    state() {
      return snapshot();
    },
    destroy() {
      clearTimer();
      path = [];
      idx = -1;
      playing = false;
    },
  };
}
