"use client";

// FR-50 action palette — a Cmd+Shift+P command-of-ACTIONS surface, distinct from
// the ⌘K node search (command-palette.tsx). It is purely presentational: the
// action list (each carrying its own run() closure) is supplied by the Explorer,
// which owns every handler — so running an action here invokes the SAME code the
// toolbar buttons do, never a fork (single source of truth). Follows the same
// WAI-ARIA combobox/listbox pattern as the ⌘K palette: the input keeps DOM focus
// and the active row is tracked via aria-activedescendant (no focus trap), ↑/↓
// move, Enter runs, Esc closes. Labels render as escaped React text — never
// innerHTML — so an action label can't inject markup.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fuzzyMatch } from "@/lib/fuzzy";

export interface PaletteAction {
  readonly id: string;
  /** The command label, e.g. "Switch to 3D". Highlighted on match. */
  readonly label: string;
  /** Optional grouping shown as a muted tag and folded into the fuzzy haystack. */
  readonly section?: string;
  /** Optional one-word live state, e.g. "on" / "current" / "open". */
  readonly state?: string;
  /** Greyed and non-invocable when true (e.g. a 3D camera action while in 2D). */
  readonly disabled?: boolean;
  /** The handler — the SAME one the matching toolbar control calls. */
  readonly run: () => void;
}

interface ActionPaletteProps {
  /** Built lazily on open — the Explorer's builder reads its live view state (and
   * surface controller ref) only when invoked here, never during the parent's
   * render. */
  readonly build: () => readonly PaletteAction[];
  readonly onClose: () => void;
}

interface Ranked {
  readonly action: PaletteAction;
  readonly matches: readonly number[];
}

export function ActionPalette({ build, onClose }: ActionPaletteProps): React.JSX.Element {
  const actions = useMemo(() => build(), [build]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (i: number): string => `${listId}-opt-${i}`;

  // Focus the field on mount; restore focus to the opener on unmount. A
  // document-level Escape closes the palette even before autofocus lands.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  // Filter + rank. An empty query keeps the catalogue order (a browsable menu);
  // a query ranks by fuzzy score, matching the label first and the section as a
  // fallback so the label highlight indices stay valid.
  const results = useMemo<Ranked[]>(() => {
    if (query.trim() === "") return actions.map((action) => ({ action, matches: [] }));
    const scored: { ranked: Ranked; score: number }[] = [];
    for (const action of actions) {
      const onLabel = fuzzyMatch(query, action.label);
      if (onLabel) {
        scored.push({ ranked: { action, matches: onLabel.matches }, score: onLabel.score });
        continue;
      }
      const onSection = action.section ? fuzzyMatch(query, action.section) : null;
      if (onSection) scored.push({ ranked: { action, matches: [] }, score: onSection.score - 2 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.ranked);
  }, [actions, query]);

  const clampedActive = results.length === 0 ? 0 : Math.min(active, results.length - 1);
  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(clampedActive))}`)
      ?.scrollIntoView({ block: "nearest" });
    // optionId is derived from the stable listId; clampedActive drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedActive, results.length]);

  const choose = useCallback(
    (i: number): void => {
      const r = results[i];
      if (!r || r.action.disabled) return;
      r.action.run();
      onClose();
    },
    [results, onClose],
  );

  const move = (delta: number): void => {
    if (results.length === 0) return;
    setActive((i) => {
      const cur = Math.min(i, results.length - 1);
      return (((cur + delta) % results.length) + results.length) % results.length;
    });
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Run an action"
        className="flex max-h-[60vh] w-[min(34rem,90vw)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(clampedActive) : undefined}
          aria-label="Run an action"
          placeholder="Run a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            switch (e.key) {
              case "ArrowDown":
                e.preventDefault();
                move(1);
                break;
              case "ArrowUp":
                e.preventDefault();
                move(-1);
                break;
              case "Enter":
                e.preventDefault();
                choose(clampedActive);
                break;
              case "Escape":
                e.preventDefault();
                onClose();
                break;
              case "Tab":
                e.preventDefault();
                break;
            }
          }}
          className="border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />

        {results.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-600">No matching actions</div>
        ) : (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Actions"
            className="min-h-0 flex-1 overflow-auto py-1"
          >
            {results.map((r, i) => {
              const on = i === clampedActive;
              const { action } = r;
              return (
                <li key={action.id} id={optionId(i)} role="option" aria-selected={on} aria-disabled={action.disabled}>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={action.disabled}
                    onMouseMove={() => {
                      if (!on) setActive(i);
                    }}
                    onClick={() => choose(i)}
                    className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm disabled:opacity-40 ${
                      on && !action.disabled ? "bg-violet-500/15" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-200">
                      <HighlightedLabel label={action.label} matches={r.matches} />
                    </span>
                    {action.state && (
                      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                        {action.state}
                      </span>
                    )}
                    {action.section && (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                        {action.section}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-1.5 text-[10px] text-zinc-600">
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span className="font-mono">{results.length}</span>
        </div>
      </div>
    </div>
  );
}

/** Render an action label with the fuzzy-matched characters emphasized (escaped text). */
function HighlightedLabel({ label, matches }: { label: string; matches: readonly number[] }): React.JSX.Element {
  if (matches.length === 0) return <>{label}</>;
  const set = new Set(matches);
  return (
    <>
      {Array.from(label).map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className="bg-transparent font-semibold text-violet-300">
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}
