"use client";

// FR-61 — the manual execution trace panel. Lists, in order, the route the user
// is assembling by clicking nodes on the board (the pure-core `TraceState` lives
// in the Explorer; this only renders it), with undo / clear / cinematic playback.
// Read-only chrome (FR-9): it reflects and drives the VIEW, never the source. A
// movable card (FR-52/FR-53), surface-agnostic — it shows the same over the 2D
// Sigma canvas and the 3D surface, both of which paint the trail themselves.

import { useDraggable } from "@/lib/use-draggable";
import { Route, Play, RotateCcw, X } from "./icons";

interface TracePanelProps {
  /** The ordered node addresses on the trace (the flattened step sequence). */
  readonly steps: readonly string[];
  /** A short, legible label for an address. */
  readonly labelFor: (address: string) => string;
  /** Select + frame a step's node — "go to this point in the trace". */
  readonly onJump: (address: string) => void;
  /** Drop the last hop. */
  readonly onUndo: () => void;
  /** Clear the whole trace. */
  readonly onClear: () => void;
  /** Play the trace back as a cinematic camera walk (needs ≥2 steps). */
  readonly onPlay: () => void;
  /** Disarm the trace tool (also clears the trace, in the Explorer). */
  readonly onClose: () => void;
}

export function TracePanel({
  steps,
  labelFor,
  onJump,
  onUndo,
  onClear,
  onPlay,
  onClose,
}: TracePanelProps): React.JSX.Element {
  // Movable card (FR-53): default top-left; drag the header or nudge by keyboard.
  // Position persists per-browser (localStorage, NEVER the snapshot) and is reset
  // by "Reset layout".
  const drag = useDraggable("codegraph:panel:trace");
  const hasSteps = steps.length > 0;
  const canPlay = steps.length > 1;

  return (
    <section
      role="region"
      aria-label="Execution trace"
      data-testid="trace-panel"
      style={drag.offset ? { left: drag.offset.x, top: drag.offset.y } : undefined}
      className={`absolute z-20 flex max-h-[calc(100%-1.5rem)] w-[19rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0d11]/97 shadow-2xl backdrop-blur ${
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
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-violet-500/15 text-violet-300">
          <Route size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold leading-tight text-zinc-100">Trace</h2>
          <p className="text-[11px] leading-tight text-zinc-500">Click nodes to build a route</p>
        </div>
        <span data-testid="trace-count" className="font-mono text-xs tabular-nums text-zinc-400">
          {steps.length}
        </span>
        <button
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close trace"
          className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <X size={13} />
        </button>
      </header>

      {/* Scrollable, ordered step list so the card stays bounded wherever it's dragged. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {hasSteps ? (
          <ol data-testid="trace-steps" className="flex flex-col gap-0.5 px-2 py-2">
            {steps.map((address, i) => (
              <li key={`${i}:${address}`}>
                <button
                  data-testid="trace-step"
                  onClick={() => onJump(address)}
                  title={address}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 font-mono text-[10px] tabular-nums text-emerald-300">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">
                    {labelFor(address)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-500">
            Click a node on the board to start, then click more to trace a route. Reachable hops fill in the
            shortest path between them.
          </p>
        )}
      </div>

      <footer className="flex items-center gap-1.5 border-t border-zinc-800/80 px-3 py-2.5">
        <button
          onClick={onPlay}
          disabled={!canPlay}
          aria-label="Play the trace as a camera walk"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
        >
          <Play size={13} /> Play
        </button>
        <button
          onClick={onUndo}
          disabled={!hasSteps}
          aria-label="Undo last hop"
          title="Undo last hop"
          className="grid size-8 place-items-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={onClear}
          disabled={!hasSteps}
          aria-label="Clear trace"
          title="Clear trace"
          className="grid size-8 place-items-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={14} />
        </button>
      </footer>
    </section>
  );
}
