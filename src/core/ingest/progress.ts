// FR-55 — repo-ingestion progress model (PURE). The local plane scans the repo
// (the scan itself lives in adapters/lang/bootstrap.ts — fs/parsers, never core)
// and streams coarse progress events as it walks → parses → resolves edges. This
// module folds that raw event stream into a deterministic, render-ready view
// model the live-progress UI binds to. No I/O here (AD-1 core purity): only state
// folding + display derivation.
//
// AD-16 / AD-14 safe: an ingest event carries ONLY counts + a repo-RELATIVE
// current path (display-only) — never source bytes, never an absolute host path —
// so the same model is safe to drive from the host stream or a dev harness.

/** The coarse phases a scan moves through. `idle` is pre-start; `error` is a
 *  terminal overlay state; the three middle phases mirror bootstrapRepo's passes. */
export const INGEST_PHASES = ["idle", "discovering", "parsing", "resolving", "done", "error"] as const;
export type IngestPhase = (typeof INGEST_PHASES)[number];

/** Single-source phase guard — the protocol envelope (host) and the webview
 *  bridge (frontend) both validate an inbound phase against this, so a malformed
 *  event is dropped at the boundary rather than driving the UI to a bad state. */
export function isIngestPhase(value: unknown): value is IngestPhase {
  return typeof value === "string" && (INGEST_PHASES as readonly string[]).includes(value);
}

/** One progress tick from the scanner. Fields are OPTIONAL so the host can post
 *  sparse deltas (e.g. just a new `parsed` count) — omitted fields keep their
 *  prior value when folded. `file` is the repo-relative path being worked, for
 *  display only. `message` carries an error reason on the `error` phase. */
export interface IngestEvent {
  readonly phase: IngestPhase;
  readonly found?: number;
  readonly parsed?: number;
  readonly failed?: number;
  readonly nodes?: number;
  readonly edges?: number;
  readonly file?: string;
  readonly message?: string;
}

/** The folded running state of a scan. */
export interface IngestState {
  readonly phase: IngestPhase;
  readonly found: number;
  readonly parsed: number;
  readonly failed: number;
  readonly nodes: number;
  readonly edges: number;
  readonly file: string | null;
  readonly error: string | null;
}

/** The at-rest state, and the reset point a fresh run folds from. */
export const IDLE_INGEST: IngestState = {
  phase: "idle",
  found: 0,
  parsed: 0,
  failed: 0,
  nodes: 0,
  edges: 0,
  file: null,
  error: null,
};

/** The ordered step track the stepper renders. `idle`/`error` are not steps:
 *  idle is pre-start, error is an overlay drawn on top of wherever the run got to. */
// Concise single-word labels so the 4-across stepper reads cleanly without
// truncation. `title` carries the fuller phrase for hover/SR context.
export const INGEST_STEPS: readonly {
  readonly phase: IngestPhase;
  readonly label: string;
  readonly title: string;
}[] = [
  { phase: "discovering", label: "Discover", title: "Discovering files" },
  { phase: "parsing", label: "Parse", title: "Parsing source" },
  { phase: "resolving", label: "Resolve", title: "Resolving edges" },
  { phase: "done", label: "Done", title: "Done" },
];

const MAX_FILE_LEN = 4096;

/** Take the event's value when it is a valid non-negative number, else keep the
 *  prior — so a sparse delta never clobbers an established count with `undefined`. */
function pick(prev: number, next: number | undefined): number {
  return typeof next === "number" && Number.isFinite(next) && next >= 0 ? Math.floor(next) : prev;
}

function pickFile(prev: string | null, next: string | undefined): string | null {
  if (typeof next !== "string") return prev;
  return next.length > MAX_FILE_LEN ? next.slice(0, MAX_FILE_LEN) : next;
}

/**
 * Fold a raw progress event into the running state. Within a run counts only
 * grow; across runs the caller resets to {@link IDLE_INGEST} first (or folds a
 * fresh `discovering` event) so a new scan starts clean. The `error` phase
 * records its message; any non-error/non-idle phase preserves a prior error so a
 * late stray tick can't silently clear a failure the UI is showing.
 */
export function ingestReducer(state: IngestState, event: IngestEvent): IngestState {
  return {
    phase: event.phase,
    found: pick(state.found, event.found),
    parsed: pick(state.parsed, event.parsed),
    failed: pick(state.failed, event.failed),
    nodes: pick(state.nodes, event.nodes),
    edges: pick(state.edges, event.edges),
    file: pickFile(state.file, event.file),
    error:
      event.phase === "error"
        ? (event.message ?? "Indexing failed").slice(0, MAX_FILE_LEN)
        : event.phase === "idle"
          ? null
          : state.error,
  };
}

/** Render-ready projection of a scan's state. */
export interface IngestView {
  readonly phase: IngestPhase;
  /** A scan is in flight (one of the three working phases). */
  readonly active: boolean;
  readonly done: boolean;
  readonly errored: boolean;
  /** Index into {@link INGEST_STEPS} for the current phase, or -1 when idle/error. */
  readonly stepIndex: number;
  /** The current phase's human label (the error message when errored). */
  readonly label: string;
  /** Best-effort 0–100 completion (parsing drives the bulk via parsed/found). */
  readonly percent: number;
  /** A one-line counts summary for the panel body. */
  readonly detail: string;
}

function percentOf(state: IngestState): number {
  switch (state.phase) {
    case "idle":
      return 0;
    case "discovering":
      return 5;
    case "parsing":
      return state.found > 0 ? Math.min(90, 10 + Math.round((80 * state.parsed) / state.found)) : 10;
    case "resolving":
      return 95;
    case "done":
      return 100;
    case "error":
      // keep the bar wherever the failed run reached (parsed share), so the user
      // sees how far it got rather than snapping to 0 or 100.
      return state.found > 0 ? Math.min(90, 10 + Math.round((80 * state.parsed) / state.found)) : 0;
  }
}

/** Infer how far a run progressed for the stepper. For the working phases this is
 *  the phase's own step; for `error` we lost the phase, so we reconstruct the
 *  reached step from the retained counts (failed during discovery → 0, parsing →
 *  1, edge resolution → 2) rather than mis-marking step 0. -1 for idle/no-step. */
function stepIndexOf(state: IngestState): number {
  if (state.phase === "error") {
    if (state.found === 0) return 0; // never got past discovery
    return state.parsed >= state.found ? 2 : 1; // resolving vs still parsing
  }
  return INGEST_STEPS.findIndex((s) => s.phase === state.phase);
}

function detailOf(state: IngestState): string {
  if (state.phase === "idle") return "Not indexed yet";
  if (state.phase === "discovering") {
    return state.found > 0 ? `${state.found} files found` : "Scanning the workspace…";
  }
  // On error keep the counts line (how far it got) — the reason rides `label`, so
  // the panel shows progress + reason side by side instead of repeating the reason.
  if (state.phase === "error" && state.found === 0) return "Indexing failed";
  const failed = state.failed > 0 ? ` · ${state.failed} skipped` : "";
  return `${state.parsed}/${state.found} files · ${state.nodes} nodes · ${state.edges} edges${failed}`;
}

/** Derive the render-ready view for a scan's state. Pure projection — no folding. */
export function ingestView(state: IngestState): IngestView {
  const stepIndex = stepIndexOf(state);
  // For the working phases the label is the step's; idle has none. (Error overrides
  // to the reason below, so its inferred stepIndex never leaks into the label.)
  const stepLabel = state.phase !== "error" && stepIndex >= 0 ? INGEST_STEPS[stepIndex].label : "";
  return {
    phase: state.phase,
    active: state.phase === "discovering" || state.phase === "parsing" || state.phase === "resolving",
    done: state.phase === "done",
    errored: state.phase === "error",
    stepIndex,
    label: state.phase === "error" ? (state.error ?? "Indexing failed") : stepLabel,
    percent: percentOf(state),
    detail: detailOf(state),
  };
}
