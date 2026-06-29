// FR-69 — the live graph-diff lens palette. Colour stays the renderer's concern
// (the same split as lib/layer-palette: the pure core yields the change KIND, the
// frontend maps it to a hue). added / changed / moved are single-sourced from the
// webview adapter's CHANGE_COLORS so the 2D Sigma reducer, the 3D draw loop, and the
// diff panel all read the SAME green / amber / violet; the frontend adds the
// red-ghost for `removed` — a removed node is gone from the live graph, so red never
// tints a surface (changesFromDelta omits removed) and shows only in the panel's
// change feed.

import { CHANGE_COLORS, type ChangeKind } from "@adapters/surfaces/webview/render-model";

/** A surface tint kind (added | changed | moved) plus the panel-only `removed`. */
export type DiffChange = ChangeKind | "removed";

export const DIFF_COLORS: Record<DiffChange, string> = {
  added: CHANGE_COLORS.added, // #3fb950 green
  changed: CHANGE_COLORS.changed, // #e3b341 amber
  moved: CHANGE_COLORS.moved, // #a371f7 violet
  removed: "#f85149", // red — panel-only (the node is gone from the board)
};

/** Stable presentation order for the counts summary + legend (severity-leaning). */
export const DIFF_ORDER: readonly DiffChange[] = ["added", "removed", "changed", "moved"];

/** The +/−/~/→ glyph for each change kind — a non-colour cue so the summary never
 * relies on hue alone (WCAG: information not by colour only). */
export const DIFF_GLYPH: Record<DiffChange, string> = {
  added: "+",
  removed: "−",
  changed: "~",
  moved: "→",
};

/** Human label for each change kind (tooltips, screen-reader text, legend). */
export const DIFF_LABEL: Record<DiffChange, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  moved: "moved",
};
