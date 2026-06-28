"use client";

// Draggable floating-panel ergonomics (FR-34 slice 3). A small companion to
// useDockState: it gives a panel an optional free-floating position so the user
// can pop it out of its docked edge and move it anywhere, by pointer or keyboard.
//
// `offset === null` means "docked" (the default); a non-null {x,y} means the
// panel is floating at that position within the workspace. Like all dock layout
// state this is a per-browser preference — it lives in localStorage, NEVER in the
// portable (and cloud-side source-blind) GraphSnapshot.

import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

export interface PanelOffset {
  readonly x: number;
  readonly y: number;
}

export interface DragHandleProps {
  readonly role: "button";
  readonly tabIndex: 0;
  readonly "aria-label": string;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface DraggableState {
  /** Floating position, or null when the panel is docked (the default). */
  readonly offset: PanelOffset | null;
  readonly dragging: boolean;
  /** Pop the panel out to a default floating position. */
  readonly float: () => void;
  /** Return the panel to its docked edge. */
  readonly dock: () => void;
  /** Spread onto the floating panel's drag handle (its header/grip). */
  readonly dragHandleProps: DragHandleProps;
}

const DEFAULT_FLOAT: PanelOffset = { x: 20, y: 20 };
const KEY_STEP = 16;
// Keep at least this much of the panel on-screen so it can never be lost.
const EDGE_KEEP = 96;

function clampOffset({ x, y }: PanelOffset): PanelOffset {
  if (typeof window === "undefined") return { x: Math.max(0, x), y: Math.max(0, y) };
  return {
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - EDGE_KEEP)),
    y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - EDGE_KEEP)),
  };
}

function read(storageKey: string): PanelOffset | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return clampOffset({ x: parsed.x, y: parsed.y });
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param storageKey unique per panel, namespaced by the caller (per-plane).
 */
export function useDraggable(storageKey: string): DraggableState {
  const [offset, setOffset] = useState<PanelOffset | null>(() => read(storageKey));
  const [dragging, setDragging] = useState(false);
  // Pointer origin + the offset at grab time, so a drag tracks deltas.
  const startRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Persist (localStorage write, not setState — safe in an effect). A null offset
  // (docked) removes the key, so a freshly-reset workspace reads as docked.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (offset) window.localStorage.setItem(storageKey, JSON.stringify(offset));
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Private mode / quota — degrade silently; dragging still works this session.
    }
  }, [storageKey, offset]);

  const float = useCallback(() => setOffset((o) => o ?? clampOffset(DEFAULT_FLOAT)), []);
  const dock = useCallback(() => setOffset(null), []);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startRef.current = { px: e.clientX, py: e.clientY, ox: offset?.x ?? 0, oy: offset?.y ?? 0 };
      setDragging(true);
    },
    [offset],
  );

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start) return;
    setOffset(clampOffset({ x: start.ox + (e.clientX - start.px), y: start.oy + (e.clientY - start.py) }));
  }, []);

  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!startRef.current) return;
    startRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const dx = e.key === "ArrowLeft" ? -KEY_STEP : e.key === "ArrowRight" ? KEY_STEP : 0;
    const dy = e.key === "ArrowUp" ? -KEY_STEP : e.key === "ArrowDown" ? KEY_STEP : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    setOffset((o) => clampOffset({ x: (o?.x ?? 0) + dx, y: (o?.y ?? 0) + dy }));
  }, []);

  return {
    offset,
    dragging,
    float,
    dock,
    dragHandleProps: {
      role: "button",
      tabIndex: 0,
      "aria-label": "Move panel (arrow keys to nudge)",
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
    },
  };
}
