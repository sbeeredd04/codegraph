// Per-package colour assignment (FR-57). The pure-core partition (partitionByPackage)
// groups nodes into monorepo packages; this maps each package to a stable, distinct
// colour so the board can read as coloured subsystems — a PERSISTENT cue, unlike the
// transient highlight the package filter drives. Presentation-only (a palette keyed
// by the partition's deterministic package order), so it lives in the frontend, not
// core. The tints are a RECESSIVE base: every interactive lens (highlight / mark /
// trace / focus / group) still overrides them.

import type { PackageInfo } from "@core/graph/package";

// A categorical palette tuned for the dark canvas — slightly muted (these sit UNDER
// the vivid lens colours) yet mutually distinct, and kept clear of the kind palette
// + lens hues (violet/emerald/trace-green) so a package tint never reads as a lens.
const PACKAGE_PALETTE: readonly string[] = [
  "#8b9bff", // periwinkle
  "#e7a6c4", // rose
  "#7fd4c1", // teal
  "#e6c184", // sand
  "#bfa1e8", // lilac
  "#a6d488", // sage
  "#f0a285", // coral
  "#8fc7e8", // sky
  "#d9b38c", // clay
  "#c5d47e", // citron
];

/** Fallback for nodes in no package (root-level files) when colouring by package. */
export const NO_PACKAGE_TINT = "#5b6477";

/**
 * Assign each package a stable colour from the palette, by the partition's order
 * (most-populated first). Wraps if there are more packages than palette entries —
 * deterministic, so the same partition always yields the same colours.
 */
export function packageColors(packages: readonly PackageInfo[]): Map<string, string> {
  const colors = new Map<string, string>();
  packages.forEach((p, i) => colors.set(p.id, PACKAGE_PALETTE[i % PACKAGE_PALETTE.length]));
  return colors;
}

/**
 * Build the per-node tint map for "colour by package": address → its package colour.
 * Nodes with no package get the recessive NO_PACKAGE_TINT. `of` is the partition's
 * address→packageId map; addresses absent from it are root-level (no package).
 */
export function packageNodeTints(
  addresses: Iterable<string>,
  of: ReadonlyMap<string, string>,
  colorById: ReadonlyMap<string, string>,
): Map<string, string> {
  const tints = new Map<string, string>();
  for (const address of addresses) {
    const pkg = of.get(address);
    tints.set(address, (pkg && colorById.get(pkg)) || NO_PACKAGE_TINT);
  }
  return tints;
}
