"use client";

// FR-49 command center — a Cmd+Space, macOS-Spotlight-style launcher that UNIONS
// the two existing surfaces: the ⌘K node search and the ⌘⇧P action palette. It is
// purely presentational; the node list (ranked by the shared core scorer) and the
// action catalogue (the SAME PaletteAction[] the toolbar drives) are supplied by
// the Explorer, so choosing a row runs the exact handler the dedicated surface
// would — never a fork (single source of truth). Same WAI-ARIA combobox/listbox
// model as the sibling palettes: the input keeps DOM focus, the active row is
// tracked via aria-activedescendant (no focus trap), ↑/↓ move, Enter opens/runs,
// Esc closes. Group headers are presentation rows (skipped by assistive tech);
// every label renders as escaped React text — never innerHTML — so an untrusted
// node name or action label can't inject markup. No animation → reduced-motion safe.

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchableNode } from "@core/search/node-search";
import { buildCommandEntries, type CommandEntry } from "@/lib/command-center-model";
import type { PaletteAction } from "@/components/action-palette";

interface CommandCenterProps {
  readonly nodes: readonly SearchableNode[];
  /** The live action catalogue, built lazily on open — the Explorer reads its view
   * state + surface-controller ref only when invoked here, never during render. */
  readonly buildActions: () => readonly PaletteAction[];
  /** Jump to a node — the SAME handler ⌘K uses (select + camera focus). */
  readonly onSelectNode: (address: string) => void;
  readonly onClose: () => void;
}

const isDisabled = (e: CommandEntry): boolean => e.kind === "action" && !!e.action.disabled;

export function CommandCenter({
  nodes,
  buildActions,
  onSelectNode,
  onClose,
}: CommandCenterProps): React.JSX.Element {
  const actions = useMemo(() => buildActions(), [buildActions]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (i: number): string => `${listId}-opt-${i}`;

  // Focus the field on mount; restore focus to the opener on unmount. A
  // document-level Escape closes the launcher even before autofocus lands.
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

  const entries = useMemo(() => buildCommandEntries(nodes, actions, query), [nodes, actions, query]);

  const clampedActive = entries.length === 0 ? 0 : Math.min(active, entries.length - 1);
  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(clampedActive))}`)
      ?.scrollIntoView({ block: "nearest" });
    // optionId is derived from the stable listId; clampedActive drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedActive, entries.length]);

  const choose = useCallback(
    (i: number): void => {
      const e = entries[i];
      if (!e || isDisabled(e)) return;
      if (e.kind === "node") onSelectNode(e.address);
      else e.action.run();
      onClose();
    },
    [entries, onSelectNode, onClose],
  );

  const move = (delta: number): void => {
    if (entries.length === 0) return;
    setActive((i) => {
      const cur = Math.min(i, entries.length - 1);
      return (((cur + delta) % entries.length) + entries.length) % entries.length;
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
        aria-label="Command center"
        className="flex max-h-[60vh] w-[min(34rem,90vw)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={entries.length ? optionId(clampedActive) : undefined}
          aria-label="Search nodes or run an action"
          placeholder="Search nodes, run actions…"
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

        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-600">No matches</div>
        ) : (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Commands"
            className="min-h-0 flex-1 overflow-auto py-1"
          >
            {entries.map((entry, i) => {
              const on = i === clampedActive;
              const disabled = isDisabled(entry);
              const header = i === 0 || entries[i - 1].kind !== entry.kind;
              return (
                <Fragment key={entry.id}>
                  {header && (
                    <li
                      role="presentation"
                      className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600"
                    >
                      {entry.kind === "node" ? "Nodes" : "Actions"}
                    </li>
                  )}
                  <li id={optionId(i)} role="option" aria-selected={on} aria-disabled={disabled}>
                    <button
                      type="button"
                      tabIndex={-1}
                      disabled={disabled}
                      onMouseMove={() => {
                        if (!on) setActive(i);
                      }}
                      onClick={() => choose(i)}
                      className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm disabled:opacity-40 ${
                        on && !disabled ? "bg-violet-500/15" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-zinc-200">
                        <Highlighted text={entry.label} matches={entry.matches} />
                      </span>
                      {entry.kind === "action" && entry.action.state && (
                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                          {entry.action.state}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                        {entry.kind === "node" ? entry.nodeKind : entry.action.section}
                      </span>
                    </button>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-1.5 text-[10px] text-zinc-600">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span className="font-mono">{entries.length}</span>
        </div>
      </div>
    </div>
  );
}

/** Render a label with the fuzzy-matched characters emphasized (escaped text). */
function Highlighted({ text, matches }: { text: string; matches: readonly number[] }): React.JSX.Element {
  if (matches.length === 0) return <>{text}</>;
  const set = new Set(matches);
  return (
    <>
      {Array.from(text).map((ch, i) =>
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
