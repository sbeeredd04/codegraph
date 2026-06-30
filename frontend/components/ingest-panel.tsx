"use client";

// FR-55 — the live repo-ingestion panel. While the host scans the workspace
// (user "Index" trigger OR the agent) this card streams the run: a phase stepper
// (discover → parse → resolve → done), a determinate progress bar, and a counts
// detail line (files parsed · nodes · edges, + a repo-relative current file). On
// failure it surfaces the reason in place. A movable card (FR-52/FR-53), surface-
// agnostic (shows over 2D and 3D alike). Read-only chrome (FR-9): it reflects a
// scan, never the source. Counts + a relative path only ever cross to it
// (AD-16/AD-14) — the same model the dev `__ingest` hook drives in e2e.

import { useDraggable } from "@/lib/use-draggable";
import { Database, RotateCcw, ShieldCheck, X } from "./icons";
import { INGEST_STEPS, type IngestView } from "@core/ingest/progress";

interface IngestPanelProps {
  /** Render-ready projection of the scan (phase/stepper/percent/detail). */
  readonly view: IngestView;
  /** The repo-relative file currently being parsed, for a live "now scanning" line. */
  readonly file: string | null;
  /** Trigger a fresh (re)index — shown once a run has settled (done/error). */
  readonly onIndex: () => void;
  /** Hide a settled card. */
  readonly onDismiss: () => void;
}

// Accent per state: building = cyan, done = emerald, failed = rose. The stepper +
// labels never lean on hue alone (WCAG 1.4.1) — done steps carry a check, the
// active step a ring + "current step" SR text, and an error its message in text.
function barColor(view: IngestView): string {
  if (view.errored) return "#fb7185"; // rose-400
  if (view.done) return "#34d399"; // emerald-400
  return "#22d3ee"; // cyan-400
}

export function IngestPanel({ view, file, onIndex, onDismiss }: IngestPanelProps): React.JSX.Element {
  // Movable card (FR-53): default below the diff card's slot; position persists
  // per-browser (localStorage, NEVER the snapshot) and resets with "Reset layout".
  const drag = useDraggable("codegraph:panel:ingest");
  const accent = barColor(view);
  const settled = view.done || view.errored;

  return (
    <section
      role="region"
      aria-label="Repository indexing"
      data-testid="ingest-panel"
      style={drag.offset ? { left: drag.offset.x, top: drag.offset.y } : undefined}
      className={`absolute z-20 flex w-[20rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0d11]/97 shadow-2xl backdrop-blur ${
        drag.offset ? "" : "left-3 top-3"
      }`}
    >
      <header
        {...drag.dragHandleProps}
        title="Drag to move · arrow keys to nudge"
        className={`flex items-center gap-2.5 border-b border-zinc-800/80 px-4 py-3 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
          drag.dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-md"
          style={{ backgroundColor: `${accent}26`, color: accent }}
        >
          {view.done ? <ShieldCheck size={14} /> : <Database size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold leading-tight text-zinc-100">Indexing</h2>
          <p className="truncate text-[11px] leading-tight text-zinc-500" data-testid="ingest-detail">
            {view.detail}
          </p>
        </div>
        <span
          data-testid="ingest-percent"
          className="font-mono text-xs tabular-nums"
          style={{ color: accent }}
        >
          {view.percent}%
        </span>
        <button
          onClick={onDismiss}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Hide indexing panel"
          className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <X size={13} />
        </button>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3.5">
        {/* Determinate progress bar — the canonical "how far along" signal. */}
        <div
          role="progressbar"
          aria-label="Indexing progress"
          aria-valuenow={view.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
        >
          <div
            data-testid="ingest-bar"
            className={`h-full rounded-full transition-[width] duration-300 ease-out ${
              view.active ? "animate-pulse" : ""
            }`}
            style={{ width: `${view.percent}%`, backgroundColor: accent }}
          />
        </div>

        {/* Phase stepper — discover → parse → resolve → done. Each step shows its
            state without relying on colour alone: done = check, current = ring +
            SR "current step", pending = muted dot. */}
        <ol data-testid="ingest-steps" className="flex items-center gap-1">
          {INGEST_STEPS.map((step, i) => {
            const isDone = view.errored ? i < view.stepIndex : i < view.stepIndex || view.done;
            const isCurrent = !view.done && !view.errored && i === view.stepIndex;
            const isErrorHere = view.errored && i === view.stepIndex;
            const dotColor = isErrorHere ? "#fb7185" : isDone ? "#34d399" : isCurrent ? accent : undefined;
            return (
              <li key={step.phase} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span
                  aria-hidden
                  className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold ${
                    isCurrent ? "ring-2 ring-offset-1 ring-offset-[#0c0d11]" : ""
                  }`}
                  style={{
                    borderColor: dotColor ?? "#3f3f46",
                    color: dotColor ?? "#71717a",
                    ...(isCurrent ? { ["--tw-ring-color" as string]: accent } : {}),
                  }}
                >
                  {isDone ? "✓" : i + 1}
                </span>
                <span
                  title={step.title}
                  className={`w-full truncate text-center text-[10px] leading-tight ${
                    isCurrent ? "text-zinc-200" : "text-zinc-400"
                  }`}
                >
                  {step.label}
                  {isCurrent && <span className="sr-only"> (current step)</span>}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Live "now scanning" line while parsing; the error reason when failed. */}
        {view.errored ? (
          <p data-testid="ingest-error" role="alert" className="text-[11px] leading-relaxed text-rose-300">
            {view.label}
          </p>
        ) : (
          file &&
          view.active && (
            <p className="truncate font-mono text-[10px] text-zinc-500" title={file}>
              {file}
            </p>
          )
        )}

        {/* Re-index once the run settles. While active the scan owns the panel. */}
        {settled && (
          <button
            data-testid="ingest-reindex"
            onClick={onIndex}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <RotateCcw size={13} /> Re-index
          </button>
        )}
      </div>
    </section>
  );
}
