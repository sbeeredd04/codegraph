"use client";

// Dashboard dock ergonomics (FR-34): a small hook that gives a side panel a
// persisted width + collapsed state and a drag/keyboard resize handle. Reused by
// the detail dock now, and the source viewer / knowledge drawers in later slices.
//
// Layout state is a per-browser preference, so it lives in localStorage — never
// in the GraphSnapshot (which is portable and, on the cloud plane, source-blind).
// The consuming panels mount only after interaction (a node is selected), so the
// lazy initializers read localStorage client-side with no SSR/hydration mismatch.

import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

export interface DockBounds {
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}

export interface DockHandleProps {
  readonly role: "separator";
  readonly tabIndex: 0;
  readonly "aria-orientation": "vertical";
  readonly "aria-label": string;
  readonly "aria-valuenow": number;
  readonly "aria-valuemin": number;
  readonly "aria-valuemax": number;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface DockState {
  readonly width: number;
  readonly collapsed: boolean;
  readonly setCollapsed: (v: boolean) => void;
  readonly toggleCollapsed: () => void;
  /** Spread onto the drag handle element (a thin strip on the panel's inner edge). */
  readonly handleProps: DockHandleProps;
  /** True while a drag is in progress — lets the panel suppress transitions. */
  readonly resizing: boolean;
}

const KEY_STEP = 24;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function read(storageKey: string): { width?: number; collapsed?: boolean } {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { width?: unknown; collapsed?: unknown };
    return {
      width: typeof parsed.width === "number" ? parsed.width : undefined,
      collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * @param storageKey  unique per dock, namespaced by the caller (per-plane).
 * @param bounds      default / min / max width in px.
 * @param side        which edge the panel is docked to; sets the resize direction.
 *                    "right" → dragging left widens; "left" → dragging right widens.
 */
export function useDockState(
  storageKey: string,
  bounds: DockBounds,
  side: "left" | "right" = "right",
): DockState {
  const { defaultWidth, minWidth, maxWidth } = bounds;
  const [width, setWidth] = useState<number>(() =>
    clamp(read(storageKey).width ?? defaultWidth, minWidth, maxWidth),
  );
  const [collapsed, setCollapsedState] = useState<boolean>(() => read(storageKey).collapsed ?? false);
  const [resizing, setResizing] = useState(false);
  const draggingRef = useRef(false);

  // Persist preferences (localStorage write, not setState — safe in an effect).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ width, collapsed }));
    } catch {
      // Private mode / quota — degrade silently; the dock still works this session.
    }
  }, [storageKey, width, collapsed]);

  const widthFromPointer = useCallback(
    (clientX: number): number => {
      const raw = side === "right" ? window.innerWidth - clientX : clientX;
      return clamp(raw, minWidth, maxWidth);
    },
    [side, minWidth, maxWidth],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setResizing(true);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      setWidth(widthFromPointer(e.clientX));
    },
    [widthFromPointer],
  );

  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setResizing(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      // Wider/narrower with arrows, regardless of side (intuitive for a separator).
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const widen = side === "right" ? e.key === "ArrowLeft" : e.key === "ArrowRight";
        setWidth((w) => clamp(w + (widen ? KEY_STEP : -KEY_STEP), minWidth, maxWidth));
      }
    },
    [side, minWidth, maxWidth],
  );

  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), []);
  const toggleCollapsed = useCallback(() => setCollapsedState((v) => !v), []);

  return {
    width,
    collapsed,
    setCollapsed,
    toggleCollapsed,
    resizing,
    handleProps: {
      role: "separator",
      tabIndex: 0,
      "aria-orientation": "vertical",
      "aria-label": "Resize panel",
      "aria-valuenow": Math.round(width),
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
    },
  };
}
