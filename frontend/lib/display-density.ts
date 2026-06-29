// FR-65 display-density (UI-scale) preference. A user-chosen bias for how tightly
// the dashboard CHROME packs — toolbar, panels, docks — surfaced in Settings. It
// drives a single `data-density` attribute on the explorer root; globals.css maps
// each value onto Tailwind v4's `--spacing` token so every spacing utility inside
// the chrome rescales without touching individual components (the graph canvas is
// absolutely positioned and uses no spacing utilities, so it is unaffected).
//
// "comfortable" is the default and keeps the prior `--spacing: 0.25rem` exactly, so
// the out-of-the-box layout is unchanged. Defined in its own tiny module (like
// reduced-motion / label-layout's LabelDensity) so both Settings and the explorer
// import it without an import cycle (settings.ts imports RenderMode from
// graph-surface, which must not depend back on settings).

export type DisplayDensity = "compact" | "comfortable" | "spacious";

export const DISPLAY_DENSITIES: readonly DisplayDensity[] = ["compact", "comfortable", "spacious"];
