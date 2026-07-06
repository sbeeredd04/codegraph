"use client";

// FR-53 (T8.5) — the first-run coach-mark for a HUMAN landing on the board for the
// first time. Distinct from the FR-42 OnboardingPanel (which mirrors the AGENT's
// codegraph_onboard bootstrap checklist and is opened on demand): this is a one-time,
// self-dismissing orientation to the three core moves — read the graph, switch lenses
// from the toolbar, ask your own connected agent. It shows once per browser (a
// localStorage flag, NEVER the snapshot — same per-browser store as the FR-34 layout
// prefs), then never again. Read-only chrome (FR-9); bottom-centre so it clears the
// top toolbar and the bottom-left legend. Reduced, not modal — it never blocks the board.

import { useEffect, useSyncExternalStore } from "react";
import { Crosshair, SlidersHorizontal, Sparkles, BookOpen } from "./icons";

const SEEN_KEY = "codegraph:first-run-hint:v1";

// A tiny external store over the localStorage "seen" flag. useSyncExternalStore reads it
// hydration-safely: the server snapshot is always `true` (render nothing), so the initial
// client render matches the server, then React re-reads the real flag post-hydration and
// reveals the hint on a genuine first visit. Every dismissal persists the flag and notifies.
const listeners = new Set<() => void>();

function subscribeSeen(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) != null;
  } catch {
    return true; // storage blocked (private mode) → fail closed, don't nag
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* storage unavailable — the listener notify below still hides it this session */
  }
  listeners.forEach((l) => l());
}

/** Clear the seen-flag so the first-run hint shows again — wired to a "Show welcome tips
 *  again" control (T18.2), so a user who dismissed it can bring the orientation back. */
export function reopenFirstRunHint(): void {
  try {
    window.localStorage.removeItem(SEEN_KEY);
  } catch {
    /* storage unavailable — the notify below still reveals it this session */
  }
  listeners.forEach((l) => l());
}

interface FirstRunHintProps {
  /** Open the first-party guide (toolbar's Guide target). Omit to hide the guide link. */
  readonly onOpenGuide?: () => void;
}

interface Move {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly detail: string;
}

const MOVES: readonly Move[] = [
  { icon: <Crosshair size={14} />, title: "Read the map", detail: "Every node is a real symbol — click one to inspect it." },
  { icon: <SlidersHorizontal size={14} />, title: "Switch lenses", detail: "The toolbar up top swaps projections, diagrams, and docs." },
  { icon: <Sparkles size={14} />, title: "Ask your agent", detail: "Ask AI hands the question to your own connected agent." },
];

export function FirstRunHint({ onOpenGuide }: FirstRunHintProps): React.JSX.Element | null {
  // getServerSnapshot returns `true` so nothing renders on the server / initial hydration
  // render — then the real flag is read, revealing the hint only on a genuine first visit.
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => true);

  // Escape dismisses (and persists, like the buttons) while the hint is showing.
  useEffect(() => {
    if (seen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") markSeen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seen]);

  if (seen) return null;
  const dismiss = markSeen;

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Welcome to codegraph"
      data-testid="first-run-hint"
      // The card BODY lets pointer events pass through to the board (so a node behind it
      // stays clickable and it never intercepts the canvas); only the buttons opt back in.
      className="pointer-events-none absolute bottom-6 left-1/2 z-30 w-[24rem] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0d11]/97 shadow-2xl backdrop-blur"
    >
      <header className="flex items-center gap-2.5 border-b border-zinc-800/80 px-4 py-3">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-violet-500/15 text-violet-300">
          <Sparkles size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold leading-tight text-zinc-100">New here?</h2>
          <p className="text-[11px] leading-tight text-zinc-500">Your codebase as a living map — the 10-second tour.</p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss welcome"
          className="pointer-events-auto grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <CloseIcon />
        </button>
      </header>

      <ul role="list" className="flex flex-col gap-0.5 px-2 py-2">
        {MOVES.map((m) => (
          <li key={m.title} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
            <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-zinc-800/80 text-zinc-300">
              {m.icon}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium leading-snug text-zinc-200">{m.title}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{m.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <footer className="flex items-center gap-2 border-t border-zinc-800/80 px-3 py-2.5">
        {onOpenGuide && (
          <button
            onClick={() => {
              dismiss();
              onOpenGuide();
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <BookOpen size={13} /> Open the guide
          </button>
        )}
        <button
          onClick={dismiss}
          className="pointer-events-auto ml-auto rounded-lg bg-violet-500/90 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          Got it
        </button>
      </footer>
    </section>
  );
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
