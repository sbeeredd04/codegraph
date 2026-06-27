// Command palette glue (PM-backlog #2): a ⌘K keyboard-first overlay to jump to any
// node by fuzzy name. Shared browser-only code (like graph-view.ts / diagram-drawer.ts)
// — it touches the DOM, so it sits outside the gate's `src/**` typecheck and is
// covered by the manual webview typecheck. The pure, unit-tested pieces (the ranking
// and the escaped, highlighted row markup) live in core/search + adapters search-view.
//
// Follows the WAI-ARIA combobox/listbox pattern: the input keeps DOM focus and the
// active row is tracked with `aria-activedescendant`, so there is no focus trap to
// manage — ↑/↓ move the active option, Enter selects, Esc closes and restores focus.

import { searchNodes, type NodeSearchResult, type SearchableNode } from "../src/core/search/node-search.js";
import { paletteRowsHtml } from "../src/adapters/surfaces/webview/search-view.js";

export interface CommandPaletteEls {
  /** Backdrop + dialog wrapper; `.open` shows it, `.gone` keeps it unmounted until first use. */
  readonly overlay: HTMLElement;
  /** The centered dialog box (clicks inside must not dismiss). */
  readonly dialog: HTMLElement;
  /** The search field (role=combobox). */
  readonly input: HTMLInputElement;
  /** The results list (role=listbox). */
  readonly list: HTMLElement;
  /** Shown when a query matches nothing. */
  readonly empty: HTMLElement;
  /** Optional result-count line in the dialog footer. */
  readonly hint?: HTMLElement;
}

export interface CommandPaletteOptions {
  /** The full node set to search (the surface owns it — snapshot or live graph). */
  readonly getNodes: () => readonly SearchableNode[];
  /** Jump to the chosen node (pan + card). The palette closes itself afterward. */
  readonly onSelect: (address: string) => void;
  /** Optional opener; focus is restored here on close. */
  readonly trigger?: HTMLElement;
}

export interface CommandPalette {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const LIMIT = 50;

/** Wire the palette once and return a small controller. */
export function createCommandPalette(
  els: CommandPaletteEls,
  opts: CommandPaletteOptions,
): CommandPalette {
  let results: NodeSearchResult[] = [];
  let active = 0;
  let lastFocus: HTMLElement | undefined;

  const isOpen = (): boolean => els.overlay.classList.contains("open");
  const rows = (): HTMLElement[] => Array.from(els.list.querySelectorAll<HTMLElement>(".cp-row"));

  const setActive = (i: number): void => {
    const all = rows();
    if (all.length === 0) {
      active = 0;
      els.input.removeAttribute("aria-activedescendant");
      return;
    }
    active = ((i % all.length) + all.length) % all.length; // wrap around both ends
    all.forEach((row, idx) => {
      const on = idx === active;
      row.classList.toggle("active", on);
      row.setAttribute("aria-selected", String(on));
    });
    const cur = all[active];
    els.input.setAttribute("aria-activedescendant", cur.id);
    cur.scrollIntoView({ block: "nearest" });
  };

  const choose = (idx: number): void => {
    const r = results[idx];
    if (!r) return;
    opts.onSelect(r.address);
    close();
  };

  const runSearch = (): void => {
    results = searchNodes(opts.getNodes(), els.input.value, { limit: LIMIT });
    els.list.innerHTML = paletteRowsHtml(results);
    const none = results.length === 0;
    els.empty.hidden = !none;
    els.list.hidden = none;
    if (els.hint) {
      els.hint.textContent = none ? "" : `${results.length}${results.length === LIMIT ? "+" : ""}`;
    }
    rows().forEach((row, idx) => {
      row.addEventListener("click", () => choose(idx));
      row.addEventListener("mousemove", () => {
        if (active !== idx) setActive(idx);
      });
    });
    setActive(0);
  };

  function open(): void {
    if (isOpen()) return;
    if (opts.getNodes().length === 0) return; // nothing to search yet — stay closed
    lastFocus = (document.activeElement as HTMLElement | null) ?? undefined;
    els.overlay.classList.remove("gone");
    els.input.value = "";
    requestAnimationFrame(() => els.overlay.classList.add("open"));
    runSearch();
    els.input.focus();
  }

  function close(): void {
    if (!isOpen()) return;
    els.overlay.classList.remove("open");
    (opts.trigger ?? lastFocus)?.focus();
  }

  els.input.addEventListener("input", runSearch);
  els.input.addEventListener("keydown", (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive(active + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive(active - 1);
        break;
      case "Enter":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        // The dialog is aria-modal but the input is its only focusable element;
        // swallow Tab so focus can't slip to the page behind the overlay.
        e.preventDefault();
        break;
    }
  });

  // Click the backdrop (but not the dialog) to dismiss.
  els.overlay.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.target === els.overlay) close();
  });

  opts.trigger?.addEventListener("click", () => (isOpen() ? close() : open()));

  // Global ⌘K / Ctrl+K toggle.
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      isOpen() ? close() : open();
    }
  });

  return { open, close, isOpen };
}
