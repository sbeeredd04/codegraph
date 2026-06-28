"use client";

// Node detail inspector (FR-15 content, FR-34 workspace frame). Two modes share
// one body:
//  - docked   → a collapsible + resizable right ResizableDock (the default).
//  - floating → popped out into a draggable card the user can place anywhere.
// The mode is a per-browser layout preference (useDraggable), never the snapshot.
// Strictly read-only (FR-9): it only reads the selected node + its edges.

import type { GraphNode, GraphEdge } from "@core/graph/types";
import { displayLabel } from "@adapters/surfaces/webview/render-model";
import { KIND_COLORS } from "@/lib/graph-data";
import { useDraggable } from "@/lib/use-draggable";
import { ResizableDock } from "./resizable-dock";

interface DetailData {
  readonly node: GraphNode;
  readonly callees: readonly GraphEdge[];
  readonly callers: readonly GraphEdge[];
}

interface DetailPanelProps {
  readonly detail: DetailData;
  readonly byAddress: Map<string, GraphNode>;
  /** Clear the selection (closes the panel). */
  readonly onClose: () => void;
  /** Open the read-only source dock for this node (FR-15). */
  readonly onViewSource: () => void;
  /** Focus a neighbour in the graph (select + pan) — the FR-25 lens. */
  readonly onJump: (address: string) => void;
}

// Floating card width — fixed (resize is a docked affordance; floating is about
// placement). Matches the docked default so popping out doesn't jump in size.
const FLOAT_WIDTH = 320;

export function DetailPanel({
  detail,
  byAddress,
  onClose,
  onViewSource,
  onJump,
}: DetailPanelProps): React.JSX.Element {
  const drag = useDraggable("codegraph:panel:detail");
  const { node } = detail;
  const title = displayLabel(node.name, node.kind);
  const dot = KIND_COLORS[node.kind] ?? "#8b93a7";

  const content = (
    <DetailContent detail={detail} byAddress={byAddress} onViewSource={onViewSource} onJump={onJump} />
  );

  // Floating mode: a draggable card placed at the persisted offset.
  if (drag.offset) {
    return (
      <aside
        role="complementary"
        aria-label="Details"
        data-testid="detail-floating"
        style={{ left: drag.offset.x, top: drag.offset.y, width: FLOAT_WIDTH }}
        className="absolute z-30 flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur"
      >
        <div
          {...drag.dragHandleProps}
          title="Drag to move · arrow keys to nudge"
          className={`flex items-center gap-2 border-b border-zinc-800 px-3 py-2 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
            drag.dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <Grip />
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
          <span className="truncate text-sm font-semibold text-zinc-50" title={node.name}>
            {title}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <IconButton onClick={drag.dock} label="Dock panel" title="Dock to the right edge">
              <DockIcon />
            </IconButton>
            <IconButton onClick={onClose} label="Close detail" title="Close">
              <span aria-hidden className="text-sm leading-none">✕</span>
            </IconButton>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm" data-testid="detail-body">
          {content}
        </div>
      </aside>
    );
  }

  // Docked mode (default): the collapsible + resizable right dock.
  return (
    <ResizableDock
      storageKey="codegraph:dock:detail"
      side="right"
      bounds={{ defaultWidth: 320, minWidth: 264, maxWidth: 560 }}
      label="Details"
      railAccent={<span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: dot }} />}
    >
      <div className="p-4 text-sm" data-testid="detail-body">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold text-zinc-50" title={node.name}>
              {title}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: dot }} />
              {node.kind}
            </div>
          </div>
          <span className="-mr-1 -mt-1 flex shrink-0 items-center gap-0.5">
            <IconButton onClick={drag.float} label="Float panel" title="Pop out as a draggable panel">
              <FloatIcon />
            </IconButton>
            <IconButton onClick={onClose} label="Close detail" title="Close">
              <span aria-hidden className="text-sm leading-none">✕</span>
            </IconButton>
          </span>
        </div>
        {content}
      </div>
    </ResizableDock>
  );
}

// The shared lower body: location, the source affordance, signature, neighbours.
function DetailContent({
  detail,
  byAddress,
  onViewSource,
  onJump,
}: {
  detail: DetailData;
  byAddress: Map<string, GraphNode>;
  onViewSource: () => void;
  onJump: (address: string) => void;
}): React.JSX.Element {
  const { node } = detail;
  return (
    <>
      <div className="mt-3 break-all font-mono text-xs text-zinc-400">
        {node.location.file}:{node.location.line}
      </div>

      {/* View source (FR-15) — opens the read-only code dock */}
      <button
        onClick={onViewSource}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <span aria-hidden>{"</>"}</span> View source
      </button>

      {node.signature && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-950/60 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
          {node.signature}
        </pre>
      )}

      <NeighborList label="Calls / depends on" edges={detail.callees} dir="to" onJump={onJump} byAddress={byAddress} />
      <NeighborList label="Called / depended on by" edges={detail.callers} dir="from" onJump={onJump} byAddress={byAddress} />
    </>
  );
}

function IconButton({
  onClick,
  label,
  title,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      {children}
    </button>
  );
}

function NeighborList({
  label,
  edges,
  dir,
  onJump,
  byAddress,
}: {
  label: string;
  edges: readonly GraphEdge[];
  dir: "to" | "from";
  onJump: (address: string) => void;
  byAddress: Map<string, GraphNode>;
}): React.JSX.Element | null {
  if (edges.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label} <span className="font-mono">{edges.length}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {edges.slice(0, 12).map((e) => {
          const addr = dir === "to" ? e.to : e.from;
          const n = byAddress.get(addr);
          return (
            <li key={`${e.from}->${e.to}:${e.type}`}>
              <button
                onClick={() => onJump(addr)}
                className="w-full truncate rounded px-1.5 py-1 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50"
                title={addr}
              >
                <span className="text-zinc-600">{e.type} </span>
                {n ? displayLabel(n.name, n.kind) : addr.split("::").pop()}
              </button>
            </li>
          );
        })}
        {edges.length > 12 && (
          <li className="px-1.5 pt-1 text-xs text-zinc-600">+{edges.length - 12} more</li>
        )}
      </ul>
    </div>
  );
}

function Grip(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-zinc-600" aria-hidden="true">
      <circle cx="8" cy="6" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <circle cx="8" cy="18" r="1.6" />
      <circle cx="16" cy="6" r="1.6" />
      <circle cx="16" cy="12" r="1.6" />
      <circle cx="16" cy="18" r="1.6" />
    </svg>
  );
}

function FloatIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <path d="M21 8v11a2 2 0 0 1-2 2H8" />
    </svg>
  );
}

function DockIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </svg>
  );
}
