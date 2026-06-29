"use client";

// Layered neighbour analysis depth control (FR-72). Floating chrome shown while
// "Layers" mode is armed: it drives how far out the concentric BFS shells expand
// from the selected node. The pure core (`@core/graph/layers`) computes the depth
// map; this panel only caps it — drag the slider (or step −/+) to peel layers
// inward, "All" to reach the end of the component. Brand-styled to match the dark
// premium system; the swatch row mirrors lib/layer-palette.ts so the legend reads
// exactly what the canvas paints. Chrome over both surfaces (the shells are painted
// by the canvas), placed bottom-centre clear of the legend (bottom-left) and the
// 3D camera cluster (bottom-right).

import { Layers, X } from "./icons";
import { LAYER_RAMP } from "@/lib/layer-palette";

interface LayerDepthControlProps {
  /** Whether a node is selected — when false the panel guides the user to pick one. */
  readonly hasSelection: boolean;
  /** The current depth cap (how many layers out to light). */
  readonly depth: number;
  /** The deepest reachable layer for the current selection (0 = isolated node). */
  readonly maxReached: number;
  /** How many nodes are currently lit (centre + every node within `depth`). */
  readonly litCount: number;
  /** Set the depth cap (the slider / steppers / "All"). */
  readonly onDepth: (depth: number) => void;
  /** Disarm Layers mode entirely. */
  readonly onClose: () => void;
  /** Lift above the 3D surface's bottom-centre movie row so the two don't overlap
   * (the 2D surface has no movie controls, so it stays at the base offset). */
  readonly raised?: boolean;
}

export function LayerDepthControl({
  hasSelection,
  depth,
  maxReached,
  litCount,
  onDepth,
  onClose,
  raised = false,
}: LayerDepthControlProps): React.JSX.Element {
  // The effective cap can never exceed what's reachable; the slider reflects that.
  const cap = Math.min(depth, maxReached);
  const atEnd = cap >= maxReached;

  return (
    <div
      data-testid="layer-depth-control"
      role="group"
      aria-label="Layer analysis depth"
      className={`pointer-events-auto absolute left-1/2 z-20 -translate-x-1/2 rounded-xl border border-zinc-800 bg-[#0c0d11]/95 px-4 py-2.5 shadow-2xl backdrop-blur-sm ${
        raised ? "bottom-20" : "bottom-4"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-violet-300">
          <Layers size={14} aria-hidden /> Layers
        </span>

        {!hasSelection ? (
          <span className="text-xs text-zinc-400">Select a node to analyse its layers.</span>
        ) : maxReached === 0 ? (
          <span className="text-xs text-zinc-400">This node stands alone — no neighbours.</span>
        ) : (
          <>
            <button
              type="button"
              aria-label="Fewer layers"
              disabled={cap <= 1}
              onClick={() => onDepth(Math.max(1, cap - 1))}
              className="grid h-6 w-6 place-items-center rounded-md border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-300 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <input
              type="range"
              aria-label="Analysis depth"
              min={1}
              max={maxReached}
              value={cap}
              onChange={(e) => onDepth(Number(e.target.value))}
              className="h-1 w-40 cursor-pointer accent-violet-400"
            />
            <button
              type="button"
              aria-label="More layers"
              disabled={atEnd}
              onClick={() => onDepth(Math.min(maxReached, cap + 1))}
              className="grid h-6 w-6 place-items-center rounded-md border border-zinc-800 bg-zinc-900/60 text-sm text-zinc-300 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
            <span className="font-mono text-[11px] tabular-nums text-zinc-400" aria-live="polite">
              depth {cap}/{maxReached}
            </span>
            <button
              type="button"
              onClick={() => onDepth(maxReached)}
              disabled={atEnd}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                atEnd
                  ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:text-zinc-100"
              }`}
            >
              All
            </button>
            <span className="text-[11px] text-zinc-500">
              <span className="font-mono tabular-nums text-zinc-300">{litCount}</span> lit
            </span>
            {/* Depth gradient legend — swatches mirror what the canvas paints. */}
            <span className="flex items-center gap-0.5" aria-hidden>
              {LAYER_RAMP.slice(0, cap + 1).map((hex, d) => (
                <span
                  key={d}
                  title={`depth ${d}`}
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </span>
          </>
        )}

        <button
          type="button"
          aria-label="Close layer analysis"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-md text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
