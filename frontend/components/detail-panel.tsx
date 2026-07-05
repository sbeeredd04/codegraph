"use client";

// Node detail inspector (FR-15 content, FR-34 workspace frame). Two modes share
// one body:
//  - docked   → a collapsible + resizable right ResizableDock (the default).
//  - floating → popped out into a draggable card the user can place anywhere.
// The mode is a per-browser layout preference (useDraggable), never the snapshot.
// Strictly read-only (FR-9): it only reads the selected node + its edges.

import { useMemo } from "react";
import type { GraphNode, GraphEdge } from "@core/graph/types";
import type { Note, Mark, Group, MarkKind } from "@core/overlays/overlay";
import { deriveFallbackNote } from "@core/docs/doc-note";
import { describeEdgeCall } from "@core/graph/edge-call";
import { parseSignature } from "@core/graph/signature";
import { detectEntryPoints } from "@core/graph/entry-point";
import { displayLabel } from "@adapters/surfaces/webview/render-model";
import { KIND_COLORS } from "@/lib/graph-data";
import { useDraggable } from "@/lib/use-draggable";
import { LogIn, Package } from "./icons";
import { ResizableDock } from "./resizable-dock";
import { AgentMarkdown } from "./agent-markdown";

interface DetailData {
  readonly node: GraphNode;
  readonly callees: readonly GraphEdge[];
  readonly callers: readonly GraphEdge[];
}

/** The agent's overlays for the selected node (FR-37): its note, its typed
 * markers, and the groups it belongs to — the shape `nodeOverlays` returns. */
export interface NodeOverlays {
  readonly note?: Note;
  readonly marks: readonly Mark[];
  readonly groups: readonly Group[];
}

interface DetailPanelProps {
  readonly detail: DetailData;
  readonly byAddress: Map<string, GraphNode>;
  /** All edges — for entry-point detection (FR-56), which is graph-wide. */
  readonly edges: readonly GraphEdge[];
  /** The agent's overlays pinned to this node (FR-37), if any. */
  readonly overlays?: NodeOverlays;
  /** Human label of the monorepo package this node lives in (FR-57), or null. */
  readonly packageLabel?: string | null;
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
  edges,
  overlays,
  packageLabel,
  onClose,
  onViewSource,
  onJump,
}: DetailPanelProps): React.JSX.Element {
  const drag = useDraggable("codegraph:panel:detail");
  const { node } = detail;
  const title = displayLabel(node.name, node.kind);
  const dot = KIND_COLORS[node.kind] ?? "#8b93a7";

  // FR-56: is this node an entry point? Detection is graph-wide; we compute the
  // ranked set once (memoised on nodes+edges) and look up the selected node.
  const entryReason = useMemo(() => {
    const eps = detectEntryPoints([...byAddress.values()], edges);
    return eps.find((e) => e.address === node.address)?.reason ?? null;
  }, [byAddress, edges, node.address]);

  const content = (
    <DetailContent
      detail={detail}
      byAddress={byAddress}
      overlays={overlays}
      entryReason={entryReason}
      packageLabel={packageLabel}
      onViewSource={onViewSource}
      onJump={onJump}
    />
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
        {/* The header doubles as the drag handle: grab it to pull the panel off the
            edge into a floating card (it lifts off from exactly where it sits — no
            jump), or use the Float button. Arrow keys nudge once focused. */}
        <div
          {...drag.dragHandleProps}
          title="Drag to move · Float to pop out · arrow keys to nudge"
          className={`-mx-1 -mt-1 mb-1 flex items-start justify-between gap-2 rounded-md px-1 py-1 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
            drag.dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div className="flex min-w-0 items-start gap-1.5">
            <span className="mt-0.5 shrink-0">
              <Grip />
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-zinc-50" title={node.name}>
                {title}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: dot }} />
                {node.kind}
              </div>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-0.5">
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

// The shared lower body: the agent's overlays, location, the source affordance,
// signature, neighbours.
function DetailContent({
  detail,
  byAddress,
  overlays,
  entryReason,
  packageLabel,
  onViewSource,
  onJump,
}: {
  detail: DetailData;
  byAddress: Map<string, GraphNode>;
  overlays?: NodeOverlays;
  entryReason: string | null;
  packageLabel?: string | null;
  onViewSource: () => void;
  onJump: (address: string) => void;
}): React.JSX.Element {
  const { node } = detail;
  // FR-60: when the agent hasn't grounded this node with a note, fall back to its
  // own docstring (cleaned by the pure-core extractor) so the node is never
  // noteless. Suppressed the moment a real agent note exists — agent grounding
  // always wins, and the two are visually distinct.
  const fallbackNote = overlays?.note ? null : deriveFallbackNote(node);
  return (
    <>
      {/* Entry point (FR-56) — "execution starts here". Up top because it reframes
          how to read everything below it. */}
      <EntryPointBadge reason={entryReason} />

      {/* Agent overlays (FR-37) — typed markers, the node's note, group membership.
          Sits up top: it's the agent's "look here, this is what's going on". */}
      <OverlaySection overlays={overlays} onJump={onJump} />

      {/* Docstring fallback (FR-60) — only when there's no agent note. */}
      <DocFallbackNote note={fallbackNote} />

      <div className="mt-3 break-all font-mono text-xs text-zinc-400">
        {node.location.file}:{node.location.line}
      </div>

      {/* Package membership (FR-57) — which monorepo workspace this node lives in. */}
      <PackageChip label={packageLabel} />

      {/* View source (FR-15) — opens the read-only code dock */}
      <button
        onClick={onViewSource}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <span aria-hidden>{"</>"}</span> View source
      </button>

      {/* FR-85: decorators (a FastAPI route, @property, @dataclass) — structural API
          surface that makes routes/handlers legible. Rendered as React children (escaped). */}
      {node.decorators && node.decorators.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="node-decorators">
          {node.decorators.map((d) => (
            <span
              key={d}
              className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-violet-200"
            >
              @{d}
            </span>
          ))}
        </div>
      )}

      {node.signature && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-950/60 p-2 font-mono text-[11px] leading-relaxed text-zinc-300">
          {node.signature}
        </pre>
      )}

      {/* FR-59: the node's input/output — parameter shapes + return type parsed
          from the signature (structural, cloud-safe), plus host-local sample I/O. */}
      <IOSection node={node} />

      <NeighborList label="Calls / depends on" edges={detail.callees} dir="to" selfNode={node} onJump={onJump} byAddress={byAddress} />
      <NeighborList label="Called / depended on by" edges={detail.callers} dir="from" selfNode={node} onJump={onJump} byAddress={byAddress} />
    </>
  );
}

// Per-mark accent (dark theme). Keyed by kind; severity (when present) is shown
// as a short suffix rather than recoloring, so the kind stays the primary signal.
const MARK_STYLE: Record<MarkKind, { label: string; className: string }> = {
  bug: { label: "bug", className: "border-red-500/40 bg-red-500/10 text-red-300" },
  breakpoint: { label: "breakpoint", className: "border-rose-500/40 bg-rose-500/10 text-rose-300" },
  issue: { label: "issue", className: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  todo: { label: "todo", className: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  hotspot: { label: "hotspot", className: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
};

// The agent's overlays for the node, rendered read-only. Mark/group labels are
// React children (escaped); the note is UNTRUSTED Markdown rendered through the
// shared <AgentMarkdown> (marked → DOMPurify strict allowlist + strict mermaid),
// so bold/code/links/diagrams render while scripts and raw HTML are stripped.
function OverlaySection({
  overlays,
  onJump,
}: {
  overlays?: NodeOverlays;
  onJump: (address: string) => void;
}): React.JSX.Element | null {
  if (!overlays) return null;
  const { note, marks, groups } = overlays;
  if (!note && marks.length === 0 && groups.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="node-overlays">
      {marks.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="node-marks">
          {marks.map((m) => {
            const style = MARK_STYLE[m.mark];
            return (
              <span
                key={m.id}
                title={m.label ? `${style.label}: ${m.label}` : style.label}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.className}`}
              >
                {style.label}
                {m.severity && <span className="font-normal opacity-70">· {m.severity}</span>}
              </span>
            );
          })}
        </div>
      )}

      {note && (
        <div
          data-testid="node-note"
          className="rounded-lg border border-violet-500/25 bg-violet-500/[0.07] p-2.5"
        >
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">
            <NoteIcon /> Note
          </div>
          <AgentMarkdown
            markdown={note.body}
            onJump={onJump}
            proseClassName="doc-prose doc-prose-sm"
            testId="node-note-md"
          />
        </div>
      )}

      {groups.length > 0 && (
        <div data-testid="node-groups">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Groups
          </div>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <span
                key={g.id}
                title={`${g.members.length} nodes`}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-medium text-cyan-300"
              >
                {g.label}
                <span className="font-mono text-[10px] opacity-70">{g.members.length}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The docstring-derived fallback (FR-60). Deliberately styled UNLIKE the agent's
// violet "Note" — a neutral slate card labelled "From docstring" — so it never
// reads as agent grounding: it's the code documenting itself until the agent
// weighs in. The body is source-derived (untrusted) → a React child, so escaped.
function DocFallbackNote({
  note,
}: {
  note: { readonly body: string; readonly source: "docstring" } | null;
}): React.JSX.Element | null {
  if (!note) return null;
  return (
    <div
      data-testid="node-doc-fallback"
      className="mt-3 rounded-lg border border-zinc-700/70 bg-zinc-800/30 p-2.5"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <DocstringIcon /> From docstring
      </div>
      <p className="text-xs leading-relaxed text-zinc-300">{note.body}</p>
    </div>
  );
}

// Entry-point badge (FR-56). A distinct emerald "start here" marker — unlike the
// agent's violet note or the neutral docstring card — with the heuristic's reason.
// The reason is a static core string, rendered as a React child regardless.
function EntryPointBadge({ reason }: { reason: string | null }): React.JSX.Element | null {
  if (!reason) return null;
  return (
    <div
      data-testid="node-entry-point"
      className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2"
    >
      <span className="shrink-0 text-emerald-300" aria-hidden>
        <LogIn size={15} />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-emerald-200">Entry point</div>
        <div className="truncate text-[11px] text-emerald-300/70" title={reason}>
          {reason}
        </div>
      </div>
    </div>
  );
}

// Package chip (FR-57). A recessive line tying the node to its monorepo package —
// supplementary metadata, so it reads quieter than the entry-point badge. The
// label is a static path-derived core string, rendered as an escaped React child.
function PackageChip({ label }: { label?: string | null }): React.JSX.Element | null {
  if (!label) return null;
  return (
    <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500" data-testid="node-package">
      <span aria-hidden className="text-zinc-600">
        <Package size={13} />
      </span>
      <span className="text-zinc-500">package</span>
      <span className="truncate font-medium text-zinc-300" title={label}>
        {label}
      </span>
    </div>
  );
}

function DocstringIcon(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function NoteIcon(): React.JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h4" />
    </svg>
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
      // Don't let a click on a header button start a panel drag (the button sits
      // inside the drag-handle header).
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={title}
      className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      {children}
    </button>
  );
}

// FR-59 — the node's input/output. Parameters and return type are parsed from the
// (structural, cloud-safe) signature; examples are host-local sample I/O values.
// Every string rendered here is a React child, so source-derived text is escaped.
function IOSection({ node }: { node: GraphNode }): React.JSX.Element | null {
  const shape = parseSignature(node.signature);
  const examples = node.examples ?? [];
  if (!shape && examples.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2.5" data-testid="node-io">
      {shape && shape.params.length > 0 && (
        <div data-testid="node-params">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Parameters <span className="font-mono">{shape.params.length}</span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {shape.params.map((p, i) => (
              <li key={`${i}:${p.name}`} className="flex items-baseline gap-1.5 text-xs">
                <span className="shrink-0 font-mono text-zinc-200">{p.name}</span>
                {p.type && (
                  <span className="truncate font-mono text-zinc-500" title={p.type}>
                    {p.type}
                  </span>
                )}
                {p.optional && (
                  <span className="ml-auto shrink-0 rounded bg-zinc-800 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-zinc-400">
                    optional
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {shape?.returns && (
        <div data-testid="node-returns">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Returns
          </div>
          <div className="font-mono text-xs break-all text-zinc-300">{shape.returns}</div>
        </div>
      )}

      {examples.length > 0 && (
        <div data-testid="node-examples">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Examples
          </div>
          <ul className="flex flex-col gap-0.5">
            {examples.map((ex, i) => (
              <li
                key={`${i}:${ex}`}
                className="rounded bg-zinc-950/50 px-2 py-1 font-mono text-[11px] break-all text-zinc-300"
              >
                {ex}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NeighborList({
  label,
  edges,
  dir,
  selfNode,
  onJump,
  byAddress,
}: {
  label: string;
  edges: readonly GraphEdge[];
  dir: "to" | "from";
  /** The selected node — the edge's target for incoming (`from`) rows. */
  selfNode: GraphNode;
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
          // FR-58: classify the edge by its TARGET. For an outgoing row the target
          // is the neighbour; for an incoming row it is the selected node — so the
          // tag reads from the right side ("constructs" vs "constructed by").
          const call = describeEdgeCall(e, dir === "to" ? n : selfNode);
          const tag = dir === "to" ? call.label : call.inverseLabel;
          return (
            <li key={`${e.from}->${e.to}:${e.type}`}>
              <button
                onClick={() => onJump(addr)}
                className="flex w-full items-baseline gap-1.5 truncate rounded px-1.5 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50"
                title={addr}
              >
                <span
                  className="shrink-0 text-[10px] text-zinc-500"
                  title={call.description}
                  data-call-kind={call.kind}
                >
                  {tag}
                </span>
                <span className="truncate font-mono">
                  {n ? displayLabel(n.name, n.kind) : addr.split("::").pop()}
                </span>
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
