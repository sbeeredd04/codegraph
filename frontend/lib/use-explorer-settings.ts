import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  clearSettings,
  loadSettings,
  saveSettings,
  type ExplorerSettings,
} from "@/lib/settings";
import type { ProjectionKind } from "@core/graph/projection";
import type { RenderMode } from "@/components/graph-surface";

interface BoardSetters {
  readonly setRenderMode: (m: RenderMode) => void;
  readonly setProjection: (p: ProjectionKind) => void;
  readonly setFolderClustered: (b: boolean) => void;
}

export interface ExplorerSettingsApi {
  readonly settings: ExplorerSettings;
  /** Change one or more preferences: persist + apply to the board live. */
  readonly changeSetting: (patch: Partial<ExplorerSettings>) => void;
  /** Forget persisted preferences and restore the board to the defaults. */
  readonly resetSettings: () => void;
}

/**
 * Own the explorer's persisted preferences (FR-51). State starts at the defaults
 * so the server-rendered toolbar matches the first client render (no hydration
 * mismatch); a post-mount rAF then loads the saved settings and applies them to
 * the board via the SAME setters the toolbar uses (single source of truth). Each
 * change persists and applies live, so a preference takes effect immediately and
 * survives a reload.
 */
export function useExplorerSettings({
  setRenderMode,
  setProjection,
  setFolderClustered,
}: BoardSetters): ExplorerSettingsApi {
  const [settings, setSettings] = useState<ExplorerSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const loaded = loadSettings();
    // Defer to a frame so the persisted values apply AFTER hydration (the server
    // rendered the defaults) and outside the synchronous effect body.
    const raf = requestAnimationFrame(() => {
      setSettings(loaded);
      setRenderMode(loaded.defaultSurface);
      setProjection(loaded.defaultProjection);
      setFolderClustered(loaded.folderClustered);
    });
    return () => cancelAnimationFrame(raf);
  }, [setRenderMode, setProjection, setFolderClustered]);

  // Plain handlers (recreated each render) so they read the current `settings`
  // without a stale closure; persistence happens here, not in the state updater.
  const changeSetting = (patch: Partial<ExplorerSettings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    if (patch.defaultSurface !== undefined) setRenderMode(patch.defaultSurface);
    if (patch.defaultProjection !== undefined) setProjection(patch.defaultProjection);
    if (patch.folderClustered !== undefined) setFolderClustered(patch.folderClustered);
  };

  const resetSettings = (): void => {
    clearSettings();
    setSettings(DEFAULT_SETTINGS);
    setRenderMode(DEFAULT_SETTINGS.defaultSurface);
    setProjection(DEFAULT_SETTINGS.defaultProjection);
    setFolderClustered(DEFAULT_SETTINGS.folderClustered);
  };

  return { settings, changeSetting, resetSettings };
}
