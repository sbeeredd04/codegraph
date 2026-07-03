"use client";

// Package → file → symbol tree dock (FR-75). The browsable counterpart to the
// fuzzy ⌘K jump: walk the codebase's own structure to reach any file / function /
// class / method. Collapsible packages + files, a live filter, and packages as
// first-class rows (click one to focus its region on the board). Docks / floats
// through the shared ResizableDock so it behaves like every other panel. Strictly
// read-only (FR-9) and structural only — it renders identities + path metadata
// (AD-14), never source. Node names are React children, so an untrusted symbol
// name is escaped and can never inject markup.

import { useCallback, useMemo, useState } from "react";
import type { GraphNode } from "@core/graph/types";
import { buildSymbolTree, type SymbolTreeFile } from "@core/graph/symbol-tree";
import { displayLabel } from "@adapters/surfaces/webview/render-model";
import { KIND_COLORS } from "@/lib/graph-data";
import { ResizableDock } from "./resizable-dock";
import { ListTree, Package, FileText, Crosshair, X } from "./icons";

interface SymbolTreeProps {
  readonly nodes: readonly GraphNode[];
  /** The currently focused package (FR-57), highlighted in the tree. */
  readonly activePackage: string | null;
  /** Jump to a file/symbol node (select + camera focus). */
  readonly onJump: (address: string) => void;
  /** Focus the board on a package region, or clear it (null). */
  readonly onFocusPackage: (id: string | null) => void;
  readonly onClose: () => void;
}

const fileMatches = (f: SymbolTreeFile, q: string): boolean =>
  f.path.toLowerCase().includes(q) || f.symbols.some((s) => s.name.toLowerCase().includes(q));

export function SymbolTreePanel({
  nodes,
  activePackage,
  onJump,
  onFocusPackage,
  onClose,
}: SymbolTreeProps): React.JSX.Element {
  const tree = useMemo(() => buildSymbolTree(nodes), [nodes]);
  const [query, setQuery] = useState("");
  // Packages open by default (usually few); files collapsed until asked for.
  const [openPkgs, setOpenPkgs] = useState<ReadonlySet<string>>(
    () => new Set(tree.packages.map((p) => p.id)),
  );
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback(
    (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    },
    [],
  );
  const togglePkg = useCallback((id: string) => setOpenPkgs((s) => toggle(s, id)), [toggle]);
  const toggleFile = useCallback((p: string) => setOpenFiles((s) => toggle(s, p)), [toggle]);

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;

  return (
    <ResizableDock
      storageKey="codegraph:dock:symbols"
      side="left"
      bounds={{ defaultWidth: 300, minWidth: 220, maxWidth: 480 }}
      label="Symbols"
      role="dialog"
      ariaLabel="Symbol tree"
      floatKey="codegraph:panel:symbols"
      surfaceClassName="bg-[#0c0d11]/97 shadow-2xl backdrop-blur"
      scrollBody={false}
      inset
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="symbol-tree">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <ListTree size={14} className="text-zinc-500" />
          <span className="text-xs font-semibold tracking-wide text-zinc-300">Symbols</span>
          <button
            onClick={onClose}
            aria-label="Close symbols"
            className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <X size={13} />
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter files and symbols"
          placeholder="Filter files & symbols…"
          data-testid="tree-filter"
          className="border-b border-zinc-800 bg-transparent px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />

        <div className="min-h-0 flex-1 overflow-auto py-1" aria-label="Package, file and symbol outline">
          {tree.packages.map((pkg) => {
            const files = filtering ? pkg.files.filter((f) => fileMatches(f, q)) : pkg.files;
            if (filtering && files.length === 0) return null;
            const open = filtering || openPkgs.has(pkg.id);
            return (
              <div key={pkg.id}>
                <div className="flex items-stretch" data-testid="tree-package">
                  <RowButton
                    depth={0}
                    open={open}
                    hasChildren
                    onToggle={() => togglePkg(pkg.id)}
                    label={pkg.label}
                    icon={<Package size={13} className="shrink-0 text-zinc-500" />}
                    count={pkg.symbolCount}
                    active={activePackage === pkg.id}
                  />
                  {/* Packages first-class: focus this package's region on the board. */}
                  <button
                    onClick={() => onFocusPackage(activePackage === pkg.id ? null : pkg.id)}
                    aria-label={activePackage === pkg.id ? `Clear focus on ${pkg.label}` : `Focus ${pkg.label} on the board`}
                    aria-pressed={activePackage === pkg.id}
                    title={activePackage === pkg.id ? "Clear package focus" : "Focus this package on the board"}
                    className={`mr-1 shrink-0 rounded px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                      activePackage === pkg.id ? "text-violet-300" : "text-zinc-600 hover:text-zinc-300"
                    }`}
                  >
                    <Crosshair size={13} />
                  </button>
                </div>
                {open && files.map((f) => (
                  <FileBranch
                    key={f.path}
                    file={f}
                    open={filtering || openFiles.has(f.path)}
                    filterQ={filtering ? q : null}
                    onToggle={() => toggleFile(f.path)}
                    onJump={onJump}
                  />
                ))}
              </div>
            );
          })}

          {(() => {
            const loose = filtering ? tree.looseFiles.filter((f) => fileMatches(f, q)) : tree.looseFiles;
            if (loose.length === 0) return null;
            return (
              <div>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  Root
                </div>
                {loose.map((f) => (
                  <FileBranch
                    key={f.path}
                    file={f}
                    open={filtering || openFiles.has(f.path)}
                    filterQ={filtering ? q : null}
                    onToggle={() => toggleFile(f.path)}
                    onJump={onJump}
                  />
                ))}
              </div>
            );
          })()}

          {tree.packages.length === 0 && tree.looseFiles.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-zinc-600">No files to show</div>
          )}
        </div>
      </div>
    </ResizableDock>
  );
}

function FileBranch({
  file,
  open,
  filterQ,
  onToggle,
  onJump,
}: {
  file: SymbolTreeFile;
  open: boolean;
  filterQ: string | null;
  onToggle: () => void;
  onJump: (address: string) => void;
}): React.JSX.Element {
  const hasSymbols = file.symbols.length > 0;
  const symbols =
    filterQ && !file.path.toLowerCase().includes(filterQ)
      ? file.symbols.filter((s) => s.name.toLowerCase().includes(filterQ))
      : file.symbols;
  return (
    <div data-testid="tree-file">
      <div className="flex items-stretch">
        <RowButton
          depth={1}
          open={open}
          hasChildren={hasSymbols}
          onToggle={onToggle}
          label={file.label}
          icon={<FileText size={13} className="shrink-0 text-zinc-500" />}
          count={hasSymbols ? file.symbols.length : undefined}
          title={file.path}
          onLabelClick={file.moduleAddress ? () => onJump(file.moduleAddress as string) : undefined}
        />
      </div>
      {open &&
        symbols.map((s) => (
          <button
            key={s.address}
            onClick={() => onJump(s.address)}
            title={s.name}
            data-testid="tree-symbol"
            style={{ paddingLeft: 8 + 2 * 16 }}
            className="flex w-full items-center gap-2 py-1 pr-2 text-left text-xs text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50 focus:outline-none focus-visible:bg-zinc-800/70"
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: KIND_COLORS[s.kind] ?? "#8b93a7" }}
            />
            <span className="min-w-0 flex-1 truncate">{displayLabel(s.name, s.kind)}</span>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-zinc-600">{s.kind}</span>
          </button>
        ))}
    </div>
  );
}

// A single expand/label row shared by package + file levels: a chevron toggle
// (only when it has children) and a label that can carry its own click (jump).
function RowButton({
  depth,
  open,
  hasChildren,
  onToggle,
  onLabelClick,
  label,
  icon,
  count,
  title,
  active,
}: {
  depth: number;
  open: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onLabelClick?: () => void;
  label: string;
  icon: React.ReactNode;
  count?: number;
  title?: string;
  active?: boolean;
}): React.JSX.Element {
  return (
    <button
      onClick={onLabelClick ?? onToggle}
      title={title ?? label}
      style={{ paddingLeft: 8 + depth * 16 }}
      className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left text-xs transition-colors focus:outline-none focus-visible:bg-zinc-800/70 ${
        active ? "text-violet-200" : "text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50"
      }`}
    >
      <span
        role={hasChildren ? "button" : undefined}
        aria-label={hasChildren ? (open ? `Collapse ${label}` : `Expand ${label}`) : undefined}
        onClick={
          hasChildren
            ? (e) => {
                // When the label carries its own action, the chevron still toggles.
                if (onLabelClick) {
                  e.stopPropagation();
                  onToggle();
                }
              }
            : undefined
        }
        className={`grid size-4 shrink-0 place-items-center text-zinc-600 ${hasChildren ? "" : "opacity-0"}`}
      >
        <Chevron open={open} />
      </span>
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {count != null && <span className="shrink-0 font-mono text-[10px] text-zinc-600">{count}</span>}
    </button>
  );
}

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform ${open ? "rotate-90" : ""} motion-reduce:transition-none`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
