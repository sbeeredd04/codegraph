"use client";

// FR-51 settings panel — a modal surface for the explorer's persisted preferences
// (the DEFAULTS the board seeds from on load). Presentational: it renders the
// current ExplorerSettings and reports changes up; the Explorer owns persistence
// and applies each change to the board through the SAME setters the toolbar uses
// (single source of truth). Same modal conventions as the palettes: role=dialog,
// aria-modal, labelled by its heading, Esc closes, focus the first control on open
// and restore focus on unmount, focus-visible rings. No animation → reduced-motion
// safe; plain React+DOM → strict-CSP safe.

import { useEffect, useId, useRef } from "react";
import { X } from "./icons";
import type { ExplorerSettings } from "@/lib/settings";
import type { ProjectionKind } from "@core/graph/projection";
import type { RenderMode } from "./graph-surface";
import type { ReduceMotionPref } from "@/lib/reduced-motion";
import type { LabelDensity } from "@/lib/label-layout-3d";
import type { DisplayDensity } from "@/lib/display-density";

interface SettingsPanelProps {
  readonly settings: ExplorerSettings;
  readonly onChange: (patch: Partial<ExplorerSettings>) => void;
  readonly onReset: () => void;
  readonly onClose: () => void;
  /** Re-show the first-run welcome hint (T18.2) — closes this panel so it's visible. */
  readonly onReplayHint?: () => void;
}

const SURFACES: { value: RenderMode; label: string }[] = [
  { value: "2d", label: "2D" },
  { value: "3d", label: "3D" },
];
const PROJECTIONS: { value: ProjectionKind; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "dependency", label: "Depends" },
  { value: "call", label: "Calls" },
  { value: "structure", label: "Structure" },
];
const REDUCE_MOTIONS: { value: ReduceMotionPref; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "Reduced" },
  { value: "off", label: "Full" },
];
const LABEL_DENSITIES: { value: LabelDensity; label: string }[] = [
  { value: "sparse", label: "Sparse" },
  { value: "balanced", label: "Balanced" },
  { value: "dense", label: "Dense" },
];
const DISPLAY_DENSITIES: { value: DisplayDensity; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];

export function SettingsPanel({ settings, onChange, onReset, onClose, onReplayHint }: SettingsPanelProps): React.JSX.Element {
  const headingId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => firstRef.current?.focus());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="flex max-h-[80vh] w-[min(34rem,90vw)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id={headingId} className="font-display text-sm font-semibold text-zinc-100">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          <Segmented
            label="Default surface"
            hint="Which graph surface the board opens on."
            options={SURFACES}
            value={settings.defaultSurface}
            onSelect={(v) => onChange({ defaultSurface: v })}
            firstRef={firstRef}
          />
          <Segmented
            label="Default projection"
            hint="Which edges the board shows at load."
            options={PROJECTIONS}
            value={settings.defaultProjection}
            onSelect={(v) => onChange({ defaultProjection: v })}
          />
          <Segmented
            label="Motion"
            hint="Camera fly-throughs and guided tours. Auto follows your system reduce-motion setting."
            options={REDUCE_MOTIONS}
            value={settings.reduceMotion}
            onSelect={(v) => onChange({ reduceMotion: v })}
          />
          <Segmented
            label="Label density"
            hint="How many node labels the graph shows. Sparse keeps it clean; Dense surfaces more."
            options={LABEL_DENSITIES}
            value={settings.labelDensity}
            onSelect={(v) => onChange({ labelDensity: v })}
          />
          <Segmented
            label="Display density"
            hint="How tightly the dashboard chrome packs — toolbar, panels, docks. The graph canvas is unaffected."
            options={DISPLAY_DENSITIES}
            value={settings.displayDensity}
            onSelect={(v) => onChange({ displayDensity: v })}
          />
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-zinc-200">Folder clustering</div>
              <div className="text-xs text-zinc-500">Gather nodes into per-folder regions (2D only).</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.folderClustered}
              aria-label="Folder clustering"
              onClick={() => onChange({ folderClustered: !settings.folderClustered })}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                settings.folderClustered ? "bg-violet-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-full bg-white transition-transform ${
                  settings.folderClustered ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* T18.2 — bring back the one-time first-run coach-mark (the only way back
              after it's dismissed). Reset-type action, so it lives here in Settings. */}
          {onReplayHint && (
            <div className="flex items-start justify-between gap-4 border-t border-zinc-800/60 pt-4">
              <div>
                <div className="text-sm font-medium text-zinc-200">Welcome tips</div>
                <div className="text-xs text-zinc-500">Re-show the first-run orientation on the board.</div>
              </div>
              <button
                type="button"
                onClick={onReplayHint}
                className="mt-0.5 shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                Show again
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md px-1 text-xs text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// A labelled segmented control — one selected value among options, styled like the
// toolbar's projection/render-mode segments.
function Segmented<T extends string>({
  label,
  hint,
  options,
  value,
  onSelect,
  firstRef,
}: {
  label: string;
  hint: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
  firstRef?: React.Ref<HTMLButtonElement>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <div className="text-sm font-medium text-zinc-200">{label}</div>
        <div className="text-xs text-zinc-500">{hint}</div>
      </div>
      <div
        role="group"
        aria-label={label}
        className="flex w-fit items-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-0.5"
      >
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onSelect(o.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              value === o.value ? "bg-zinc-700/80 text-zinc-50" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
