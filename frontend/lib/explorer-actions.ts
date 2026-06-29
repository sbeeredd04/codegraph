// FR-50: the explorer's action catalogue for the Cmd+Shift+P palette. This is a
// PURE builder — given the current view state plus the Explorer's own state
// setters and callbacks, it composes the ordered PaletteAction[] the palette
// renders. Every `run` ends up calling the SAME setter/handler the matching
// toolbar control uses, so the palette never forks behaviour (single source of
// truth); `state`/`disabled` mirror what the toolbar shows. Composing the runs
// here (rather than at the call site) keeps the Explorer under the file-size cap.

import type { Dispatch, SetStateAction } from "react";
import type { ProjectionKind } from "@core/graph/projection";
import type { PaletteAction } from "@/components/action-palette";
import type { RenderMode } from "@/components/graph-surface";
import type { SurfaceController } from "@/lib/surface-controller";

const PROJECTIONS: { readonly id: ProjectionKind; readonly label: string }[] = [
  { id: "full", label: "Full" },
  { id: "dependency", label: "Depends" },
  { id: "call", label: "Calls" },
  { id: "structure", label: "Structure" },
];

export interface ExplorerActionContext {
  // Live view state — drives the `state` badge + `disabled` gating so the palette
  // stays a faithful mirror of the toolbar.
  readonly renderMode: RenderMode;
  readonly projection: ProjectionKind;
  readonly folderClustered: boolean;
  readonly orphanMode: boolean;
  readonly orphanCount: number;
  readonly traceArmed: boolean;
  readonly diagramsOpen: boolean;
  readonly docsOpen: boolean;
  readonly onboardOpen: boolean;
  readonly hasSelection: boolean;
  readonly assistEnabled: boolean;
  // The Explorer's own state setters + callbacks — the SAME ones the toolbar uses.
  readonly setRenderMode: (m: RenderMode) => void;
  readonly setProjection: (p: ProjectionKind) => void;
  readonly setFolderClustered: Dispatch<SetStateAction<boolean>>;
  readonly setOrphanMode: Dispatch<SetStateAction<boolean>>;
  readonly setTraceArmed: Dispatch<SetStateAction<boolean>>;
  readonly setDiagramsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setDocsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setOnboardOpen: Dispatch<SetStateAction<boolean>>;
  readonly setAskOpen: Dispatch<SetStateAction<boolean>>;
  readonly setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  readonly setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  readonly resetLayout: () => void;
  readonly navigateGuide: () => void;
  /** Live surface controller (FR-43) — null between mounts; 3D camera/movie only. */
  readonly controller: () => SurfaceController | null;
}

const onOff = (b: boolean): string => (b ? "on" : "off");

export function buildExplorerActions(ctx: ExplorerActionContext): PaletteAction[] {
  const is3d = ctx.renderMode === "3d";
  const actions: PaletteAction[] = [
    {
      id: "surface-2d",
      section: "Surface",
      label: "Switch to 2D",
      state: ctx.renderMode === "2d" ? "current" : undefined,
      run: () => ctx.setRenderMode("2d"),
    },
    {
      id: "surface-3d",
      section: "Surface",
      label: "Switch to 3D",
      state: is3d ? "current" : undefined,
      run: () => ctx.setRenderMode("3d"),
    },
    ...PROJECTIONS.map(
      (p): PaletteAction => ({
        id: `projection-${p.id}`,
        section: "Projection",
        label: `Projection: ${p.label}`,
        state: ctx.projection === p.id ? "current" : undefined,
        run: () => ctx.setProjection(p.id),
      }),
    ),
    {
      id: "lens-folders",
      section: "Lenses",
      label: "Toggle folder clustering",
      state: onOff(ctx.folderClustered),
      disabled: is3d,
      run: () => ctx.setFolderClustered((v) => !v),
    },
    {
      id: "lens-orphans",
      section: "Lenses",
      label: "Toggle orphan overlay",
      state: onOff(ctx.orphanMode),
      disabled: is3d || ctx.orphanCount === 0,
      run: () => ctx.setOrphanMode((v) => !v),
    },
    {
      id: "lens-trace",
      section: "Lenses",
      label: "Toggle trace path",
      state: onOff(ctx.traceArmed),
      disabled: is3d,
      run: () => ctx.setTraceArmed((v) => !v),
    },
    {
      id: "camera-reset",
      section: "Camera",
      label: "Reset camera view",
      disabled: !is3d,
      run: () => ctx.controller()?.resetCamera?.(),
    },
    {
      id: "camera-fit",
      section: "Camera",
      label: "Fit graph to view",
      disabled: !is3d,
      run: () => ctx.controller()?.fitCamera?.(),
    },
    {
      id: "camera-tour",
      section: "Camera",
      label: "Play guided tour of selection",
      disabled: !is3d || !ctx.hasSelection,
      run: () => ctx.controller()?.playTour?.(),
    },
    {
      id: "panel-diagrams",
      section: "Panels",
      label: "Open knowledge diagrams",
      state: ctx.diagramsOpen ? "open" : undefined,
      run: () => {
        ctx.setDocsOpen(false);
        ctx.setDiagramsOpen(true);
      },
    },
    {
      id: "panel-docs",
      section: "Panels",
      label: "Open knowledge docs",
      state: ctx.docsOpen ? "open" : undefined,
      run: () => {
        ctx.setDiagramsOpen(false);
        ctx.setDocsOpen(true);
      },
    },
  ];

  if (ctx.assistEnabled) {
    actions.push({
      id: "panel-ask",
      section: "Panels",
      label: "Ask your agent",
      run: () => ctx.setAskOpen(true),
    });
  }

  actions.push(
    {
      id: "panel-setup",
      section: "Panels",
      label: "Toggle setup checklist",
      state: ctx.onboardOpen ? "open" : undefined,
      run: () => ctx.setOnboardOpen((v) => !v),
    },
    {
      id: "panel-search",
      section: "Panels",
      label: "Search nodes",
      run: () => ctx.setPaletteOpen(true),
    },
    {
      id: "panel-settings",
      section: "Panels",
      label: "Open settings",
      run: () => ctx.setSettingsOpen(true),
    },
    { id: "nav-guide", section: "Navigate", label: "Open the guide", run: ctx.navigateGuide },
    { id: "layout-reset", section: "Layout", label: "Reset panel layout", run: ctx.resetLayout },
  );

  return actions;
}
