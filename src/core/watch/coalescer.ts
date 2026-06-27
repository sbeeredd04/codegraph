// Debounced change coalescer (Story 2.1, the running Job B): file-change events
// arrive in bursts (a save, a formatter pass, an AI multi-file edit). Coalesce
// them into one flush after a quiet window so the graph re-scans once per burst,
// not once per keystroke. Pure: the clock is injected, so debounce is testable
// without real time and the core stays I/O-free (AD-1).

export interface Clock {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const realClock: Clock = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Coalescer {
  /** Record a changed path; (re)arms the quiet-window timer. */
  notify(path: string): void;
  /** Cancel any pending flush and drop the current batch. */
  dispose(): void;
}

/**
 * Collect notified paths and, once `windowMs` passes with no new notification,
 * fire `onFlush` once with the deduped batch. Each notify resets the window.
 */
export function createCoalescer(
  windowMs: number,
  onFlush: (paths: string[]) => void,
  clock: Clock = realClock,
): Coalescer {
  let batch = new Set<string>();
  let handle: unknown;

  const flush = (): void => {
    handle = undefined;
    if (batch.size === 0) return;
    const paths = [...batch];
    batch = new Set();
    onFlush(paths);
  };

  return {
    notify(path: string): void {
      batch.add(path);
      if (handle !== undefined) clock.clearTimer(handle);
      handle = clock.setTimer(flush, windowMs);
    },
    dispose(): void {
      if (handle !== undefined) clock.clearTimer(handle);
      handle = undefined;
      batch = new Set();
    },
  };
}
