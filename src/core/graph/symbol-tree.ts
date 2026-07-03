// Package → file → symbol outline (FR-75). A pure, deterministic hierarchy over
// the graph so the board can offer a browsable tree — the fast way to look up a
// file / function / class / method by walking the codebase's own structure,
// complementing the fuzzy ⌘K jump. Built ENTIRELY from identities + `location`
// path metadata that already rides the snapshot: structural, cloud-safe (AD-14),
// no source bytes, no fs/network. The ordering + bucketing (the fiddly part) is
// unit-tested here so the UI stays a thin renderer.

import type { GraphNode, NodeKind } from "./types.js";
import { partitionByPackage } from "./package.js";

/** A leaf symbol — a function / class / method living in a file. */
export interface SymbolTreeSymbol {
  readonly address: string;
  readonly name: string;
  readonly kind: NodeKind;
  readonly line: number;
}

/** A file node: the module itself plus the symbols declared in it. */
export interface SymbolTreeFile {
  /** Repo-relative path (the module's `location.file`). */
  readonly path: string;
  /** Basename, for the row label. */
  readonly label: string;
  /** The module node's address (jump target for the file row), or null if the
   *  graph carried symbols for a file but no module node. */
  readonly moduleAddress: string | null;
  readonly symbols: readonly SymbolTreeSymbol[];
}

/** A package/workspace bucket with its files. */
export interface SymbolTreePackage {
  readonly id: string;
  readonly label: string;
  readonly files: readonly SymbolTreeFile[];
  /** Total symbols across the package's files — a count badge for the row. */
  readonly symbolCount: number;
}

export interface SymbolTree {
  /** Packages most-populated first (the package.ts ordering). */
  readonly packages: readonly SymbolTreePackage[];
  /** Files with no enclosing package (root-level files) — a trailing bucket. */
  readonly looseFiles: readonly SymbolTreeFile[];
}

const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Order symbols by source position, then name, then address — fully stable. */
function bySymbol(a: SymbolTreeSymbol, b: SymbolTreeSymbol): number {
  return a.line - b.line || a.name.localeCompare(b.name) || a.address.localeCompare(b.address);
}

/**
 * Build the package → file → symbol tree for `nodes`. Files are grouped by their
 * `location.file`; the module node (if any) becomes the file's jump target and
 * every non-module node becomes a symbol. Files are then bucketed into packages
 * via the shared path partition (package.ts), preserving its most-populated-first
 * ordering; root-level files with no package fall into `looseFiles`. Pure and
 * deterministic: identical nodes → identical tree, safe to recompute per render.
 */
export function buildSymbolTree(nodes: readonly GraphNode[]): SymbolTree {
  const partition = partitionByPackage(nodes);

  // 1. Group nodes by file, splitting the module node from its symbols.
  const byFile = new Map<string, { moduleAddress: string | null; symbols: SymbolTreeSymbol[] }>();
  for (const n of nodes) {
    const file = n.location.file;
    let entry = byFile.get(file);
    if (!entry) {
      entry = { moduleAddress: null, symbols: [] };
      byFile.set(file, entry);
    }
    if (n.kind === "module") entry.moduleAddress = n.address;
    else entry.symbols.push({ address: n.address, name: n.name, kind: n.kind, line: n.location.line });
  }

  // 2. Materialise files; remember each file's package via any of its nodes.
  const pkgOfFile = new Map<string, string | null>();
  const files: SymbolTreeFile[] = [];
  for (const [path, entry] of byFile) {
    entry.symbols.sort(bySymbol);
    files.push({ path, label: basename(path), moduleAddress: entry.moduleAddress, symbols: entry.symbols });
    const probe = entry.moduleAddress ?? entry.symbols[0]?.address;
    pkgOfFile.set(path, probe ? partition.of.get(probe) ?? null : null);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  // 3. Bucket files into packages (partition order) + a loose root bucket.
  const filesByPkg = new Map<string, SymbolTreeFile[]>();
  const looseFiles: SymbolTreeFile[] = [];
  for (const f of files) {
    const pkg = pkgOfFile.get(f.path) ?? null;
    if (pkg == null) {
      looseFiles.push(f);
      continue;
    }
    const bucket = filesByPkg.get(pkg);
    if (bucket) bucket.push(f);
    else filesByPkg.set(pkg, [f]);
  }

  const packages: SymbolTreePackage[] = partition.packages
    .map((p) => {
      const pkgFiles = filesByPkg.get(p.id) ?? [];
      const symbolCount = pkgFiles.reduce((sum, f) => sum + f.symbols.length, 0);
      return { id: p.id, label: p.label, files: pkgFiles, symbolCount };
    })
    .filter((p) => p.files.length > 0);

  return { packages, looseFiles };
}
