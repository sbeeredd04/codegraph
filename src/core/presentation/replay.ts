// FR-40 (Epic 19, Phase C): the PURE step-sequencer behind the guided tour. The
// agent issues a `replay` command (command.ts) naming an ordered set of stops;
// this module turns that set into a timed plan the surface controller schedules —
// when each stop lights, which nodes are lit by then, and where the camera frames.
//
// It is pure (no timers, no DOM, no I/O) so the order/timing math and the
// reduced-motion fallback are unit-testable headlessly; the surface controllers
// (2D Sigma / 3D) own only the wall-clock scheduling and the actual highlight +
// camera calls. Keeping the math here means both surfaces step identically (AD-15).

/** Default per-step dwell when the command omits one (a comfortable reading beat). */
export const REPLAY_DWELL_DEFAULT_MS = 1_200;
/** Floor — fast enough for tests, slow enough to perceive a step. */
export const REPLAY_DWELL_MIN_MS = 200;
/** Ceiling — an UNTRUSTED driver can't stall the surface for minutes per step. */
export const REPLAY_DWELL_MAX_MS = 10_000;

/** Clamp an advisory dwell to the sane band, defaulting a missing / non-finite one. */
export function clampDwell(ms?: number): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return REPLAY_DWELL_DEFAULT_MS;
  return Math.max(REPLAY_DWELL_MIN_MS, Math.min(REPLAY_DWELL_MAX_MS, Math.round(ms)));
}

/** One stop on the tour: the surface frames `focus` and lights the cumulative set. */
export interface ReplayStep {
  /** 0-based position in the tour. */
  readonly index: number;
  /** the single node this step frames (the camera follows it). */
  readonly focus: string;
  /** every stop reached so far, in order — the growing highlighted trail. */
  readonly highlight: readonly string[];
  /** when this step begins, relative to the tour start (ms). */
  readonly startMs: number;
  /** whether this is the final stop (the trail is then complete). */
  readonly isLast: boolean;
}

export interface ReplayPlan {
  readonly steps: readonly ReplayStep[];
  /** the resolved (clamped) dwell every step uses. */
  readonly dwellMs: number;
  /** total wall-clock span of the tour (ms); 0 for an empty or reduced-motion plan. */
  readonly durationMs: number;
  /** true when the plan collapsed to a single instant step (no animation). */
  readonly reducedMotion: boolean;
}

export interface ReplayOptions {
  readonly dwellMs?: number;
  /** honour `prefers-reduced-motion`: collapse the tour to its final state at once. */
  readonly reducedMotion?: boolean;
}

/**
 * Plan a guided tour over `addresses`. Empty stops are dropped; an all-empty set
 * yields an empty plan (the controller no-ops). Under reduced motion the whole
 * trail lights at once, framed on the last stop, with no per-step timing — the
 * accessible fallback to the animated walk.
 */
export function planReplay(addresses: readonly string[], opts: ReplayOptions = {}): ReplayPlan {
  const dwellMs = clampDwell(opts.dwellMs);
  const seq = addresses.filter((a) => typeof a === "string" && a.length > 0);

  if (seq.length === 0) {
    return { steps: [], dwellMs, durationMs: 0, reducedMotion: opts.reducedMotion === true };
  }

  if (opts.reducedMotion === true) {
    return {
      steps: [{ index: 0, focus: seq[seq.length - 1], highlight: seq, startMs: 0, isLast: true }],
      dwellMs,
      durationMs: 0,
      reducedMotion: true,
    };
  }

  const steps: ReplayStep[] = seq.map((focus, i) => ({
    index: i,
    focus,
    highlight: seq.slice(0, i + 1),
    startMs: i * dwellMs,
    isLast: i === seq.length - 1,
  }));
  return { steps, dwellMs, durationMs: seq.length * dwellMs, reducedMotion: false };
}
