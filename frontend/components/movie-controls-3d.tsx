"use client";

// Movie-mode transport UI for the 3D surface (FR-48). Presentational only — the
// player state machine lives in lib/movie-player-3d.ts and is driven by the
// surface; this just renders the affordance and forwards intent.
//
// Two states:
//  - idle, a node selected -> a single "Play tour" trigger that flies through the
//    selected node's neighbourhood.
//  - active -> a transport bar: prev / play-pause / next, a "i / N — label"
//    readout, and a close button. Under reduced motion the play-pause control is
//    hidden (auto-stepping is suppressed) so the viewer steps deliberately.
//
// Anchored bottom-centre so it clears the bottom-right camera cluster and the
// bottom-left kind legend.

import { Play, Pause, SkipBack, SkipForward, Film, X } from "./icons";
import type { MovieState } from "@/lib/movie-player-3d";

interface MovieControls3DProps {
  readonly state: MovieState;
  /** A node is selected, so a neighbourhood fly-through can be started. */
  readonly canPlay: boolean;
  readonly onPlayFocus: () => void;
  readonly onToggle: () => void;
  readonly onNext: () => void;
  readonly onPrev: () => void;
  readonly onStop: () => void;
}

const ctrlBtn =
  "inline-flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-400 disabled:opacity-30 disabled:hover:bg-transparent";

export function MovieControls3D({
  state,
  canPlay,
  onPlayFocus,
  onToggle,
  onNext,
  onPrev,
  onStop,
}: MovieControls3DProps): React.JSX.Element | null {
  if (!state.active) {
    if (!canPlay) return null;
    return (
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 select-none">
        <button
          type="button"
          onClick={onPlayFocus}
          aria-label="Play a guided fly-through of this node's connections"
          title="Play a guided fly-through of this node's connections"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#14161c]/90 px-3 py-1.5 text-xs font-medium text-white/80 shadow-lg shadow-black/40 backdrop-blur transition-colors hover:border-violet-400/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-400"
        >
          <Film size={14} />
          <span>Play tour</span>
        </button>
      </div>
    );
  }

  const atStart = state.index <= 0;
  const atEnd = state.index >= state.total - 1;
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 select-none">
      <div
        role="group"
        aria-label="Movie mode controls"
        className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-[#14161c]/90 p-1 pr-2 shadow-lg shadow-black/40 backdrop-blur"
      >
        <button type="button" onClick={onPrev} disabled={atStart} aria-label="Previous node" title="Previous node" className={ctrlBtn}>
          <SkipBack size={15} />
        </button>
        {!state.reduced && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={state.playing ? "Pause tour" : "Play tour"}
            title={state.playing ? "Pause tour" : "Play tour"}
            className={ctrlBtn}
          >
            {state.playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
        )}
        <button type="button" onClick={onNext} disabled={atEnd} aria-label="Next node" title="Next node" className={ctrlBtn}>
          <SkipForward size={15} />
        </button>
        <div className="mx-1 flex items-baseline gap-1.5 whitespace-nowrap text-[11px] leading-none">
          <span className="font-mono tabular-nums text-white/45">
            {state.index + 1}/{state.total}
          </span>
          <span className="max-w-[14rem] truncate font-mono text-emerald-300/90" title={state.label}>
            {state.label}
          </span>
        </div>
        <button type="button" onClick={onStop} aria-label="Exit movie mode" title="Exit movie mode" className={ctrlBtn}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
