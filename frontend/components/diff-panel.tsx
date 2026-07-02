"use client";

// FR-69 — the live graph-diff panel. While the Diff lens is armed it pins a baseline
// snapshot and lists what changed between it and the live graph: a +N / −N / ~N / →N
// summary (deltaCounts) and the impact-ranked change feed (rankedChangeFeed), biggest
// blast radius first. Clicking an added / changed / moved row jumps + frames that node
// (FR-25 focus); removed rows are ghosted + inert (the node is gone from the board).
// Read-only chrome (FR-9): it reflects and drives the VIEW, never the source. A movable
// card (FR-52/FR-53), surface-agnostic — the same panel shows over the 2D Sigma canvas
// and the 3D surface, both of which tint the changed nodes themselves.

import { useDraggable } from "@/lib/use-draggable";
import { GitCompare, X } from "./icons";
import type { DeltaCounts } from "@adapters/surfaces/webview/render-model";
import type { RankedChange } from "@core/graph/change-feed";
import { DIFF_COLORS, DIFF_GLYPH, DIFF_LABEL, DIFF_ORDER, type DiffChange } from "@/lib/diff-palette";

interface DiffPanelProps {
  /** A baseline has been captured — drives the empty state vs the change list. */
  readonly hasBaseline: boolean;
  /** The +/−/~/→ tallies, or null before a baseline is pinned. */
  readonly counts: DeltaCounts | null;
  /** The blast-radius-ranked changes (empty until a differing baseline is set). */
  readonly feed: readonly RankedChange[];
  /** Pin the current graph as the baseline to compare against. */
  readonly onSetBaseline: () => void;
  /** Pin a realistic synthetic earlier version so the lens has something to show where
   * there's no live re-index channel (web plane). Omitted in the extension, which
   * re-scans for a real diff. */
  readonly onSampleDiff?: () => void;
  /** Drop the baseline back to the empty state. */
  readonly onClearBaseline: () => void;
  /** Select + frame a changed node (added / changed / moved). */
  readonly onJump: (address: string) => void;
  /** Disarm the diff lens. The baseline is kept so re-arming resumes the same diff;
   * "Clear baseline" drops it explicitly. */
  readonly onClose: () => void;
}

/** Total changes across all kinds — drives the header count + empty state. */
function totalChanges(c: DeltaCounts | null): number {
  return c ? c.added + c.removed + c.changed + c.moved : 0;
}

export function DiffPanel({
  hasBaseline,
  counts,
  feed,
  onSetBaseline,
  onSampleDiff,
  onClearBaseline,
  onJump,
  onClose,
}: DiffPanelProps): React.JSX.Element {
  // Movable card (FR-53): default top-left; position persists per-browser
  // (localStorage, NEVER the snapshot) and resets with "Reset layout".
  const drag = useDraggable("codegraph:panel:diff");
  const total = totalChanges(counts);
  const countOf = (k: DiffChange): number => (counts ? counts[k] : 0);

  return (
    <section
      role="region"
      aria-label="Graph diff"
      data-testid="diff-panel"
      style={drag.offset ? { left: drag.offset.x, top: drag.offset.y } : undefined}
      className={`absolute z-20 flex max-h-[calc(100%-1.5rem)] w-[20rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0d11]/97 shadow-2xl backdrop-blur ${
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
          <GitCompare size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold leading-tight text-zinc-100">Diff</h2>
          <p className="text-[11px] leading-tight text-zinc-500">
            {hasBaseline ? "Changes vs the baseline" : "Compare against a baseline"}
          </p>
        </div>
        {hasBaseline && (
          <span data-testid="diff-count" className="font-mono text-xs tabular-nums text-zinc-400">
            {total}
          </span>
        )}
        <button
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close diff"
          className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <X size={13} />
        </button>
      </header>

      {!hasBaseline ? (
        // Empty state — guide the user to pin a reference point.
        <div className="flex flex-col gap-3 px-4 py-5">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Pin the current graph as a baseline, then re-index your repo to see exactly what was added,
            removed, changed, or moved — ranked by how much depends on it.
          </p>
          <button
            data-testid="diff-set-baseline"
            onClick={onSetBaseline}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <GitCompare size={13} /> Set baseline
          </button>
          {onSampleDiff && (
            // No live re-index channel here (web plane) — let the user see the lens work
            // immediately against a realistic synthetic "previous version" of this graph.
            <button
              data-testid="diff-sample"
              onClick={onSampleDiff}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              Try a sample diff
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Counts summary — each kind carries a +/−/~/→ glyph + word, never colour
              alone (WCAG: information not by colour only). */}
          <div
            data-testid="diff-counts"
            role="list"
            aria-label="Change counts"
            className="flex items-center gap-1.5 border-b border-zinc-800/80 px-3 py-2.5"
          >
            {DIFF_ORDER.map((k) => (
              <span
                key={k}
                role="listitem"
                title={`${countOf(k)} ${DIFF_LABEL[k]}`}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5"
              >
                <span aria-hidden className="font-mono text-xs font-semibold" style={{ color: DIFF_COLORS[k] }}>
                  {DIFF_GLYPH[k]}
                </span>
                <span className="font-mono text-xs tabular-nums text-zinc-300">{countOf(k)}</span>
                <span className="sr-only">{DIFF_LABEL[k]}</span>
              </span>
            ))}
          </div>

          {/* Ranked change feed — biggest blast radius first. */}
          <div className="min-h-0 flex-1 overflow-auto">
            {feed.length ? (
              <ul data-testid="diff-feed" className="flex flex-col gap-0.5 px-2 py-2">
                {feed.map((c) => {
                  const removed = c.change === "removed";
                  const kind = c.change as DiffChange;
                  // WCAG 1.4.1: the +/−/~/→ glyph (not colour alone) carries the kind —
                  // an added row reads differently from a moved row without seeing hue.
                  const glyph = (
                    <span
                      aria-hidden
                      className="w-3 shrink-0 text-center font-mono text-xs font-semibold"
                      style={{ color: DIFF_COLORS[kind] }}
                    >
                      {DIFF_GLYPH[kind]}
                    </span>
                  );
                  const body = (
                    <>
                      {glyph}
                      <span className="sr-only">{DIFF_LABEL[kind]}</span>
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-xs ${
                          removed ? "text-zinc-400 line-through" : "text-zinc-200"
                        }`}
                      >
                        {c.name}
                      </span>
                      <span
                        title={`${c.blastRadius} dependent${c.blastRadius === 1 ? "" : "s"}`}
                        className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500"
                      >
                        {c.blastRadius}
                      </span>
                    </>
                  );
                  return (
                    <li key={`${c.change}:${c.address}`} data-testid="diff-row" data-change={c.change}>
                      {removed ? (
                        <div
                          title={`${DIFF_LABEL.removed} · ${c.address}`}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
                        >
                          {body}
                        </div>
                      ) : (
                        <button
                          onClick={() => onJump(c.address)}
                          title={`${DIFF_LABEL[c.change as DiffChange]} · ${c.address}`}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
                        >
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-zinc-500">
                No changes vs the baseline. Re-index the repo (or switch datasets) and the differences will
                light up here and on the board.
              </p>
            )}
          </div>

          <footer className="flex items-center gap-1.5 border-t border-zinc-800/80 px-3 py-2.5">
            <button
              onClick={onSetBaseline}
              title="Re-pin the baseline to the current graph"
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <GitCompare size={13} /> Update baseline
            </button>
            <button
              onClick={onClearBaseline}
              aria-label="Clear baseline"
              title="Clear the baseline"
              className="grid size-8 place-items-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <X size={14} />
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
