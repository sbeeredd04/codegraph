"use client";

// A collapsible + resizable side dock (FR-34). Provides the workspace frame —
// positioning, a drag/keyboard resize handle, and a collapse-to-rail toggle —
// while the children own their content and chrome. The resize/collapse state is
// persisted per-browser via useDockState. Used by the node detail dock now; the
// source viewer and knowledge drawers adopt it in later slices.

import type { ReactNode } from "react";
import { useDockState, type DockBounds, type DockHandleProps } from "@/lib/use-dock-state";
import { useDraggable } from "@/lib/use-draggable";
import { GripVertical, PanelFloat, PanelDock } from "./icons";

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
  /** Float the dock as an INSET panel — a gap from the viewport edges, rounded
   *  corners + full border + shadow — so the graph stays visible around it and it
   *  reads as a section ON the board rather than a full-bleed page (FR-35 follow-up).
   *  Default false keeps the flush full-height dock. */
  readonly inset?: boolean;
  /** When false, children own their scrolling (multi-pane drawers keep a fixed
   *  header + independently-scrolling panes). Default true wraps them in a single
   *  scroll region. */
  readonly scrollBody?: boolean;
  /** Per-browser localStorage key for a FREE-FLOATING placement (FR-52). When set,
   *  the dock gains a Float control: the user can pop it out of its edge into a
   *  draggable card (and dock it back). Omit to keep a dock-only panel. The
   *  floating offset lives in localStorage, NEVER the snapshot (AD-14). */
  readonly floatKey?: string;
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
  inset = false,
  floatKey,
  children,
}: ResizableDockProps): React.JSX.Element {
  const { width, collapsed, setCollapsed, resizing, handleProps } = useDockState(
    storageKey,
    bounds,
    side,
  );
  // FR-52: optional free-floating placement. The hook is called unconditionally
  // (a constant fallback key that's never floated when floatKey is absent).
  const drag = useDraggable(floatKey ?? "codegraph:nofloat");
  // T8.7: the COLLAPSED rail is independently draggable so two rails sharing an
  // edge can be pulled apart and organised. Its own persisted offset (distinct
  // from the expanded float above) — per-browser localStorage, never the snapshot.
  const railDrag = useDraggable(`${storageKey}:rail`);
  const floatable = floatKey != null;
  const name = ariaLabel ?? label;

  // Floating: a draggable card at the persisted offset, keeping the docked width
  // so popping out doesn't jump in size. A thin grab bar carries the move handle
  // + a Dock control; the panel's own header/chrome lives in `children` below.
  if (floatable && drag.offset) {
    const bodyEl = scrollBody ? (
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    ) : (
      children
    );
    return (
      <aside
        role={role}
        aria-label={name}
        data-testid={`floating-${storageKey}`}
        style={{ left: drag.offset.x, top: drag.offset.y, width }}
        className={`absolute z-30 flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-800 shadow-2xl ${surfaceClassName}`}
      >
        <div
          {...drag.dragHandleProps}
          title="Drag to move · arrow keys to nudge"
          className={`flex items-center gap-1.5 border-b border-zinc-800/80 px-2.5 py-1.5 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
            drag.dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <GripVertical size={14} className="text-zinc-600" />
          <span className="text-[11px] font-medium tracking-wide text-zinc-400">{label}</span>
          <button
            onClick={drag.dock}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Dock ${label}`}
            title={`Dock ${label} to the edge`}
            className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <PanelDock size={13} />
          </button>
        </div>
        {bodyEl}
      </aside>
    );
  }

  const edge = side === "right" ? "right-0" : "left-0";
  // Inset floats the panel off the edges as a card; flush pins it full-height to
  // the docked edge. The border closes to all sides (rounded card) when inset.
  const position = inset
    ? `${side === "right" ? "right-3" : "left-3"} top-3 bottom-3`
    : `${edge} top-0 bottom-0`;
  const sideBorder = side === "right" ? "border-l" : "border-r";
  const frame = inset ? "rounded-2xl border border-zinc-800" : `${sideBorder} border-zinc-800`;

  if (collapsed) {
    // A COMPACT tab hugging the edge, vertically centred — not a full-height bar
    // (which read as an empty black column). Only as tall as its content; the
    // board-facing corners round so it reads as a pull-tab. A grip lets the user
    // drag the rail anywhere from there (T8.7); a persisted offset frees it from
    // the edge so it can be placed off to the side rather than stuck at centre.
    const edgeClass = inset ? (side === "right" ? "right-3" : "left-3") : edge;
    const railPos = railDrag.offset != null ? "" : `${edgeClass} top-1/2 -translate-y-1/2`;
    const railStyle = railDrag.offset != null
      ? { left: railDrag.offset.x, top: railDrag.offset.y }
      : undefined;
    const railShape = inset
      ? "rounded-xl border border-zinc-800 shadow-2xl"
      : side === "right"
        ? "rounded-l-xl border border-r-0 border-zinc-800"
        : "rounded-r-xl border border-l-0 border-zinc-800";
    return (
      <aside
        className={`absolute ${railPos} z-20`}
        style={railStyle}
        role={role}
        aria-label={name}
        data-testid={`rail-${storageKey}`}
      >
        <div
          style={{ width: RAIL_W }}
          className={`flex flex-col items-center overflow-hidden ${railShape} bg-zinc-900/95 backdrop-blur`}
        >
          {/* Drag grip — repositions the rail so stacked rails can be pulled apart.
              A plain click on the Expand button below still opens the panel; the
              grip is a separate target that only moves, so there's no click/drag
              ambiguity. Arrow keys nudge it once focused. */}
          <div
            {...railDrag.dragHandleProps}
            aria-label={`Move ${label} rail (arrow keys to nudge)`}
            title={`Drag to move the ${label} rail`}
            className={`flex w-full justify-center pt-1.5 pb-1 text-zinc-600 transition-colors hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
              railDrag.dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            <GripVertical size={13} />
          </div>
          <button
            onClick={() => setCollapsed(false)}
            aria-label={`Expand ${label}`}
            aria-expanded={false}
            title={`Expand ${label}`}
            className="flex w-full flex-col items-center gap-2.5 px-0 pt-1 pb-3 text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
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
          {/* Snap a moved rail back to its edge anchor. */}
          {railDrag.offset != null && (
            <button
              onClick={railDrag.dock}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={`Return ${label} rail to the edge`}
              title={`Snap the ${label} rail back to the edge`}
              className="mb-1.5 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <PanelDock size={13} />
            </button>
          )}
        </div>
      </aside>
    );
  }

  const handle = (
    <div className="relative flex w-2.5 shrink-0 items-stretch">
      <DockResizeHandle handleProps={handleProps} resizing={resizing} />
      {/* Stacked control cluster on the handle: collapse, then (if floatable) pop-out. */}
      <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-col gap-1.5">
        <button
          onClick={() => setCollapsed(true)}
          aria-label={`Collapse ${label}`}
          aria-expanded
          title={`Collapse ${label}`}
          className="rounded-md border border-zinc-700 bg-zinc-900 p-0.5 text-zinc-400 shadow transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <Chevron dir={side === "right" ? "right" : "left"} />
        </button>
        {floatable && (
          <button
            onClick={drag.float}
            aria-label={`Float ${label}`}
            title={`Pop ${label} out as a floating panel`}
            className="rounded-md border border-zinc-700 bg-zinc-900 p-0.5 text-zinc-400 shadow transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <PanelFloat size={14} />
          </button>
        )}
      </div>
    </div>
  );

  const body = (
    <div
      style={{ width }}
      className={`flex min-w-0 flex-col overflow-hidden ${frame} ${surfaceClassName} ${
        resizing ? "" : "transition-[width] duration-150 motion-reduce:transition-none"
      }`}
    >
      {scrollBody ? <div className="min-h-0 flex-1 overflow-auto">{children}</div> : children}
    </div>
  );

  return (
    <aside className={`absolute ${position} z-20 flex`} role={role} aria-label={name}>
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
