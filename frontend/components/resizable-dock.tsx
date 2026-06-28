"use client";

// A collapsible + resizable side dock (FR-34). Provides the workspace frame —
// positioning, a drag/keyboard resize handle, and a collapse-to-rail toggle —
// while the children own their content and chrome. The resize/collapse state is
// persisted per-browser via useDockState. Used by the node detail dock now; the
// source viewer and knowledge drawers adopt it in later slices.

import type { ReactNode } from "react";
import { useDockState, type DockBounds, type DockHandleProps } from "@/lib/use-dock-state";

/**
 * The draggable / keyboard-focusable resize strip. Shared so any dock — the
 * ResizableDock frame below, or a panel that wires useDockState directly (the
 * source viewer) — renders an identical handle.
 */
export function DockResizeHandle({
  handleProps,
  resizing,
}: {
  handleProps: DockHandleProps;
  resizing: boolean;
}): React.JSX.Element {
  return (
    <div
      {...handleProps}
      title="Drag to resize · ← → to adjust"
      className={`group flex w-2.5 shrink-0 cursor-col-resize items-center justify-center focus:outline-none ${
        resizing ? "bg-violet-500/40" : "hover:bg-violet-500/25 focus-visible:bg-violet-500/30"
      } transition-colors`}
    >
      <span
        aria-hidden
        className={`h-10 w-0.5 rounded-full ${
          resizing ? "bg-violet-400" : "bg-zinc-700 group-hover:bg-violet-400/70"
        }`}
      />
    </div>
  );
}

interface ResizableDockProps {
  /** Unique, per-plane-namespaced localStorage key for this dock's layout. */
  readonly storageKey: string;
  readonly side?: "left" | "right";
  readonly bounds: DockBounds;
  /** Short label for the collapsed rail and the collapse/expand controls. */
  readonly label: string;
  /** Landmark role for the outer element (e.g. "dialog" for the knowledge
   *  drawers). Defaults to a plain complementary <aside>. */
  readonly role?: string;
  /** Accessible name for the dock; defaults to `label`. Lets the rail stay short
   *  ("Diagrams") while the dock announces a fuller name ("Knowledge diagrams"). */
  readonly ariaLabel?: string;
  /** Optional accent (e.g. a kind dot) shown on the collapsed rail. */
  readonly railAccent?: ReactNode;
  /** Body surface classes (bg + shadow). Defaults to the standard dock surface. */
  readonly surfaceClassName?: string;
  /** When false, children own their scrolling (multi-pane drawers keep a fixed
   *  header + independently-scrolling panes). Default true wraps them in a single
   *  scroll region. */
  readonly scrollBody?: boolean;
  readonly children: ReactNode;
}

const RAIL_W = 40;
const DEFAULT_SURFACE = "bg-zinc-900/95 backdrop-blur";

export function ResizableDock({
  storageKey,
  side = "right",
  bounds,
  label,
  role,
  ariaLabel,
  railAccent,
  surfaceClassName = DEFAULT_SURFACE,
  scrollBody = true,
  children,
}: ResizableDockProps): React.JSX.Element {
  const { width, collapsed, setCollapsed, resizing, handleProps } = useDockState(
    storageKey,
    bounds,
    side,
  );
  const edge = side === "right" ? "right-0" : "left-0";
  const name = ariaLabel ?? label;

  if (collapsed) {
    return (
      <aside className={`absolute ${edge} top-0 bottom-0 z-20`} role={role} aria-label={name}>
        <button
          onClick={() => setCollapsed(false)}
          aria-label={`Expand ${label}`}
          aria-expanded={false}
          title={`Expand ${label}`}
          style={{ width: RAIL_W }}
          className={`flex h-full flex-col items-center gap-3 ${
            side === "right" ? "border-l" : "border-r"
          } border-zinc-800 bg-zinc-900/95 py-3 text-zinc-400 backdrop-blur transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500`}
        >
          <Chevron dir={side === "right" ? "left" : "right"} />
          <span
            className="text-[11px] font-medium tracking-wide text-zinc-400"
            style={{ writingMode: "vertical-rl" }}
          >
            {label}
          </span>
          {railAccent}
        </button>
      </aside>
    );
  }

  const handle = (
    <div className="relative flex w-2.5 shrink-0 items-stretch">
      <DockResizeHandle handleProps={handleProps} resizing={resizing} />
      <button
        onClick={() => setCollapsed(true)}
        aria-label={`Collapse ${label}`}
        aria-expanded
        title={`Collapse ${label}`}
        className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900 p-0.5 text-zinc-400 shadow transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <Chevron dir={side === "right" ? "right" : "left"} />
      </button>
    </div>
  );

  const body = (
    <div
      style={{ width }}
      className={`flex min-w-0 flex-col overflow-hidden ${
        side === "right" ? "border-l" : "border-r"
      } border-zinc-800 ${surfaceClassName} ${
        resizing ? "" : "transition-[width] duration-150 motion-reduce:transition-none"
      }`}
    >
      {scrollBody ? <div className="min-h-0 flex-1 overflow-auto">{children}</div> : children}
    </div>
  );

  return (
    <aside className={`absolute ${edge} top-0 bottom-0 z-20 flex`} role={role} aria-label={name}>
      {side === "right" ? (
        <>
          {handle}
          {body}
        </>
      ) : (
        <>
          {body}
          {handle}
        </>
      )}
    </aside>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === "left" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}
