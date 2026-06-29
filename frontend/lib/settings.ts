// FR-51: the explorer's persisted preferences. A tiny, validated settings model
// backed by localStorage (the same per-browser store the FR-34 layout prefs use).
// It defines the DEFAULTS the board seeds from on load — the live toolbar toggles
// stay session-only view changes; Settings is what survives a reload. Values are
// validated on read so an old or hand-edited localStorage blob can't inject a bad
// enum into the board (validate at the boundary).

import type { ProjectionKind } from "@core/graph/projection";
import type { RenderMode } from "@/components/graph-surface";
import type { ReduceMotionPref } from "@/lib/reduced-motion";

export interface ExplorerSettings {
  /** Surface the board opens on (FR-17). */
  readonly defaultSurface: RenderMode;
  /** Projection the board opens on (FR-4). */
  readonly defaultProjection: ProjectionKind;
  /** Whether folder clustering (FR-26) is on at load (2D only). */
  readonly folderClustered: boolean;
  /** Reduce-motion override (FR-51-deferred): "auto" follows the OS, "on" forces
   * calm camera/replay, "off" forces animation. */
  readonly reduceMotion: ReduceMotionPref;
}

export const DEFAULT_SETTINGS: ExplorerSettings = {
  defaultSurface: "2d",
  defaultProjection: "full",
  folderClustered: false,
  reduceMotion: "auto",
};

export const SETTINGS_KEY = "codegraph:settings";

const SURFACES: readonly RenderMode[] = ["2d", "3d"];
const PROJECTIONS: readonly ProjectionKind[] = ["full", "dependency", "call", "structure"];
const REDUCE_MOTIONS: readonly ReduceMotionPref[] = ["auto", "on", "off"];

/** Read persisted settings, falling back to the default for anything missing or
 * malformed. SSR-safe — returns defaults when there is no window. */
export function loadSettings(): ExplorerSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SETTINGS_KEY);
  } catch {
    return DEFAULT_SETTINGS; // private mode / storage disabled
  }
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof ExplorerSettings, unknown>>;
    return {
      defaultSurface: SURFACES.includes(parsed.defaultSurface as RenderMode)
        ? (parsed.defaultSurface as RenderMode)
        : DEFAULT_SETTINGS.defaultSurface,
      defaultProjection: PROJECTIONS.includes(parsed.defaultProjection as ProjectionKind)
        ? (parsed.defaultProjection as ProjectionKind)
        : DEFAULT_SETTINGS.defaultProjection,
      folderClustered:
        typeof parsed.folderClustered === "boolean"
          ? parsed.folderClustered
          : DEFAULT_SETTINGS.folderClustered,
      reduceMotion: REDUCE_MOTIONS.includes(parsed.reduceMotion as ReduceMotionPref)
        ? (parsed.reduceMotion as ReduceMotionPref)
        : DEFAULT_SETTINGS.reduceMotion,
    };
  } catch {
    return DEFAULT_SETTINGS; // corrupt JSON
  }
}

/** Persist settings; silently no-ops when storage is unavailable. */
export function saveSettings(settings: ExplorerSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // quota / private mode — the session value still applies, just not persisted.
  }
}

/** Forget persisted settings (used by "Reset to defaults"). */
export function clearSettings(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // ignore
  }
}
