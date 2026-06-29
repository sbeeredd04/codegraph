"use client";

// Bottom-left colour legend — extracted from the Explorer shell (FR-69 cap-relief) so
// the shell stays under the file-size cap. Chrome over both surfaces (FR-53): the key
// switches from node KINDS to PACKAGES while "colour by package" (FR-57) is armed, so
// the persistent package tints stay decodable. Purely presentational; pointer-through.

import { KIND_COLORS } from "@/lib/graph-data";
import { NO_PACKAGE_TINT } from "@/lib/package-palette";
import type { PackageInfo } from "@core/graph/package";

interface GraphLegendProps {
  /** "Colour by package" armed — show the package key instead of the kind key. */
  readonly showPackages: boolean;
  readonly packages: readonly PackageInfo[];
  readonly pkgColors: ReadonlyMap<string, string>;
  /** How many nodes belong to a named package (the rest are root-level). */
  readonly packagedCount: number;
  /** Total node count, for the root-level remainder row. */
  readonly totalCount: number;
}

export function GraphLegend({
  showPackages,
  packages,
  pkgColors,
  packagedCount,
  totalCount,
}: GraphLegendProps): React.JSX.Element {
  if (showPackages && packages.length >= 2) {
    return (
      <div
        role="img"
        aria-label="Legend: node colours by package"
        className="pointer-events-none absolute bottom-3 left-3 flex max-h-[40vh] flex-col gap-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5 text-xs backdrop-blur"
      >
        {packages.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-zinc-400">
            <span
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: pkgColors.get(p.id) }}
            />
            <span className="truncate">{p.label}</span>
            <span className="ml-auto pl-2 tabular-nums text-zinc-600">{p.count}</span>
          </div>
        ))}
        {packagedCount < totalCount && (
          <div className="flex items-center gap-2 text-zinc-400">
            <span
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: NO_PACKAGE_TINT }}
            />
            <span className="truncate">root</span>
            <span className="ml-auto pl-2 tabular-nums text-zinc-600">{totalCount - packagedCount}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Legend: node colours by kind"
      className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5 text-xs backdrop-blur"
    >
      {Object.entries(KIND_COLORS).map(([kind, color]) => (
        <div key={kind} className="flex items-center gap-2 text-zinc-400">
          <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color }} />
          {kind}
        </div>
      ))}
    </div>
  );
}
