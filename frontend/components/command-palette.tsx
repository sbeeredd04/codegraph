"use client";

// ⌘K command palette for the Next.js explorer (Story 8.4 / PM-backlog #2). Large
// graphs are unnavigable without jump-to-node; this is the React port of the
// webview palette (webview/command-palette.ts), reusing the SAME tested ranking
// from core/search/node-search.ts so both surfaces order results identically.
//
// Mounted only while open (the explorer owns the ⌘K toggle and the mounted flag),
// so its query/active state is fresh per open with no reset effect — keeping
// effects free of synchronous setState. Follows the WAI-ARIA combobox/listbox
// pattern: the input keeps DOM focus and the active row is tracked via
// aria-activedescendant, so there is no focus trap — ↑/↓ move, Enter selects, Esc
// closes. Rows render the matched name as escaped React text (no innerHTML), so
// an untrusted node name can never inject markup.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { searchNodes, type SearchableNode } from "@core/search/node-search";

const LIMIT = 50;

interface CommandPaletteProps {
  readonly nodes: readonly SearchableNode[];
  readonly onClose: () => void;
  /** Jump to the chosen node (select + camera focus). The palette closes itself. */
  readonly onSelect: (address: string) => void;
}

export function CommandPalette({ nodes, onClose, onSelect }: CommandPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (i: number): string => `${listId}-opt-${i}`;

  // Focus the field on mount; restore focus to the opener on unmount. A
  // document-level Escape handler closes the palette even before autofocus has
  // landed on the input (the input's own Escape covers the focused case).
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

  const results = useMemo(() => searchNodes(nodes, query, { limit: LIMIT }), [nodes, query]);

  // Keep the active row in range as results change, and scroll it into view.
  const clampedActive = results.length === 0 ? 0 : Math.min(active, results.length - 1);
  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(optionId(clampedActive))}`)?.scrollIntoView({ block: "nearest" });
    // optionId is derived from the stable listId; clampedActive drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedActive, results.length]);

  const choose = useCallback(
    (i: number): void => {
      const r = results[i];
      if (!r) return;
      onSelect(r.address);
      onClose();
    },
    [results, onSelect, onClose],
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
        aria-label="Search nodes"
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
          aria-label="Search nodes by name"
          placeholder="Jump to a node…"
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
          <div className="px-4 py-8 text-center text-xs text-zinc-600">No matching nodes</div>
        ) : (
          <ul ref={listRef} id={listId} role="listbox" aria-label="Nodes" className="min-h-0 flex-1 overflow-auto py-1">
            {results.map((r, i) => {
              const on = i === clampedActive;
              return (
                <li key={r.address} id={optionId(i)} role="option" aria-selected={on}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseMove={() => {
                      if (!on) setActive(i);
                    }}
                    onClick={() => choose(i)}
                    className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm ${on ? "bg-violet-500/15" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-zinc-200">
                      <HighlightedName name={r.name} matches={r.nameMatches} />
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">{r.kind}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-1.5 text-[10px] text-zinc-600">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span className="font-mono">
            {results.length}
            {results.length === LIMIT ? "+" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Render a node name with the fuzzy-matched characters emphasized (escaped text). */
function HighlightedName({ name, matches }: { name: string; matches: readonly number[] }): React.JSX.Element {
  if (matches.length === 0) return <>{name}</>;
  const set = new Set(matches);
  return (
    <>
      {Array.from(name).map((ch, i) =>
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
