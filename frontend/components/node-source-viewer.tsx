"use client";

// Read-only source-code viewer for a selected node (FR-15) — the "spaceship
// dashboard" code panel. Source bytes arrive over the `SourceText` contract,
// host-LOCAL only (AD-16): here that means fetching the first-party sidecar a
// local/static build ships. When no source is available (hosted plane, or a
// third-party graph with no bundled source) it degrades to a clear card rather
// than failing. The code surface is CodeMirror 6 (FR-70) — language-aware
// highlighting, a line gutter, the def line marked + scrolled-to — mounted
// view-only (FR-9): the canonical edit path is "Open in editor", never a silent
// write. CM6 sets source as document content (never HTML), so untrusted source
// can never inject markup, and it is eval-free so it boots under the strict CSP.

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildSourceView } from "@core/source/source-view";
import { buildEditorLink, editorById, DEFAULT_EDITOR } from "@core/links/editor-link";
import { isWebviewHost, revealInEditor } from "@/lib/webview-bridge";
import { useDockState } from "@/lib/use-dock-state";
import { useDraggable, type PanelOffset } from "@/lib/use-draggable";
import { DockResizeHandle } from "./resizable-dock";
import { CodeSurface } from "./code-surface";
import { Crosshair, ShieldCheck, X } from "./icons";

// Floating-mode geometry (FR-52). Width matches the dock's default so popping out
// never jumps in size. The default landing offset is DISTINCT from the detail
// panel's {20,20} so, even though the two are mutually exclusive on screen, a
// floated source viewer never lands exactly where a floated detail panel would.
const FLOAT_WIDTH = 640;
const SOURCE_FLOAT_OFFSET: PanelOffset = { x: 64, y: 64 };

type Loaded = { text: string; anchor: number };
type ViewState =
  | { status: "loading" }
  | { status: "ready"; data: Loaded }
  | { status: "unavailable" }
  | { status: "error" };

interface NodeSourceViewerProps {
  /** Base URL of the source sidecar, or `null` when this host serves no source (AD-16). */
  readonly sourceBase: string | null;
  /**
   * Absolute repo root on the host, for an "open in editor" deep link (FR-32).
   * Present only inside the VS Code webview; `null` on the web/cloud (AD-14).
   */
  readonly editorRoot?: string | null;
  /** Repo-relative file path (the node's `location.file`). */
  readonly file: string;
  /** 0-based defining line (the node's `location.line`). */
  readonly line: number;
  /** 0-based defining column (the node's `location.character`), for the deep link. */
  readonly character?: number;
  /** Human label for the node (already shortened via displayLabel). */
  readonly title: string;
  /** The node's signature, shown as a fallback when source is unavailable. */
  readonly signature?: string;
  /**
   * FR-71 — "locate in graph": flash this node + its neighbours in the graph
   * (the connections peek). Wired from the explorer to `peekNode(address)`;
   * absent when there is no graph surface to drive (e.g. a standalone test mount).
   */
  readonly onLocate?: () => void;
  readonly onClose: () => void;
}

export function NodeSourceViewer({
  sourceBase,
  editorRoot = null,
  file,
  line,
  character,
  title,
  signature,
  onLocate,
  onClose,
}: NodeSourceViewerProps): React.JSX.Element {
  // Lazy initial state: "unavailable" up front when this host serves no source,
  // else "loading" until the fetch resolves. The parent keys this component on
  // (sourceBase, file, line) so a new node remounts it — which is why the effect
  // never needs a synchronous reset (that would cause a cascading render).
  const [state, setState] = useState<ViewState>(() =>
    sourceBase ? { status: "loading" } : { status: "unavailable" },
  );

  // The code pane is the panel that benefits most from a wider drag — a resize
  // handle on its inner edge, with the width persisted per-browser (FR-34). No
  // collapse: the viewer already has an explicit Close, and it remounts per node.
  const { width, resizing, handleProps } = useDockState(
    "codegraph:dock:source",
    { defaultWidth: 640, minWidth: 400, maxWidth: 1100 },
    "right",
  );

  // FR-52: the viewer can also pop OUT of its docked edge into a free-floating,
  // draggable card the user can place anywhere — the same float system the detail
  // panel uses. The mode is a per-browser layout preference (never the snapshot).
  const drag = useDraggable("codegraph:panel:source", SOURCE_FLOAT_OFFSET);

  // Fetch (and degrade gracefully). Host-local source only: no sidecar → unavailable.
  useEffect(() => {
    if (!sourceBase) return; // initial state is already "unavailable"
    let cancelled = false;
    const url = `${sourceBase}/${file.split("/").map(encodeURIComponent).join("/")}`;
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (cancelled) return;
        const view = buildSourceView(text, line);
        setState({ status: "ready", data: { text, anchor: view.anchor } });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceBase, file, line]);

  // Esc closes the viewer (returns to the detail panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // "Open in editor" deep link (FR-32). buildEditorLink returns null unless the
  // host gave us an absolute root, so this is naturally withheld on the
  // source-blind web/cloud and present inside the VS Code webview.
  const editorLink = useMemo(
    () => buildEditorLink({ root: editorRoot, file, line, column: character }),
    [editorRoot, file, line, character],
  );
  const editorLabel = editorById(DEFAULT_EDITOR).label;

  // Inside the VS Code webview, reveal natively (FR-31): post the repo-relative
  // path to the host, which runs showTextDocument — smoother than the URI handler
  // and it keeps the absolute root host-side. The `vscode://file` href stays as a
  // no-JS / middle-click fallback (FR-32). Checked at click time (not render) so
  // there is no SSR/hydration mismatch on the static export. No-op on the web.
  const onEditorOpen = useCallback(
    (e: React.MouseEvent) => {
      if (isWebviewHost()) {
        e.preventDefault();
        revealInEditor(file, line, character);
      }
    },
    [file, line, character],
  );

  // Shared header identity (title, read-only badge, file:line, editor deep-link)
  // and the scrollable code body — rendered identically whether docked or floating.
  const headerInfo = (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-zinc-50">{title}</span>
        <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Read-only
        </span>
      </div>
      <div className="mt-0.5 truncate font-mono text-xs text-zinc-500" title={file}>
        {file}:{line + 1}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {editorLink && (
          <a
            href={editorLink}
            onClick={onEditorOpen}
            data-testid="open-in-editor"
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <ArrowUpRight />
            Open in {editorLabel}
          </a>
        )}
        {/* FR-71 code→graph sync: jump to where this open file sits in the graph
            and flash its connections (the cyan "peek"). Transient — never changes
            the selected node or opens the detail panel. */}
        {onLocate && (
          <button
            onClick={onLocate}
            data-testid="locate-in-graph"
            aria-label="Locate in graph"
            title="Highlight this node and its connections in the graph"
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <Crosshair size={12} />
            Locate in graph
          </button>
        )}
      </div>
    </div>
  );

  const body = (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0b0c10]">
      {state.status === "loading" && (
        <div className="grid flex-1 place-items-center text-xs text-zinc-600">Loading source…</div>
      )}

      {state.status === "unavailable" && (
        <div className="min-h-0 flex-1 overflow-auto">
          <UnavailableCard
            signature={signature}
            editorLink={editorLink}
            editorLabel={editorLabel}
            onEditorOpen={onEditorOpen}
          />
        </div>
      )}

      {state.status === "error" && (
        <div className="grid flex-1 place-items-center px-6 text-center text-xs text-zinc-500">
          Couldn’t read this file.
        </div>
      )}

      {/* FR-70 — the real CodeMirror 6 surface: language-aware highlighting, a line
          gutter, the node's def line marked + scrolled to centre. View-only here
          (FR-9): no plane grants in-webview editing — the canonical edit path stays
          "Open in {editor}" above. CM6 is eval-free so it boots under the strict
          no-eval webview CSP (proven by cm-csp-smoke). */}
      {state.status === "ready" && (
        <div className="min-h-0 flex-1">
          <CodeSurface text={state.data.text} anchorLine={state.data.anchor} fileName={file} />
        </div>
      )}
    </div>
  );

  // Floating mode: a draggable card at the persisted offset. Stays a
  // role="region"/"Source for…" landmark (FR-15) — only its frame changes.
  if (drag.offset) {
    return (
      <aside
        role="region"
        aria-label={`Source for ${title}`}
        data-testid="source-floating"
        style={{ left: drag.offset.x, top: drag.offset.y, width: FLOAT_WIDTH }}
        className="absolute z-20 flex h-[min(34rem,calc(100%-1.5rem))] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur"
      >
        <header className="flex items-start gap-2 border-b border-zinc-800 px-3 py-2">
          <span
            {...drag.dragHandleProps}
            title="Drag to move · arrow keys to nudge"
            className={`mt-0.5 shrink-0 rounded p-0.5 text-zinc-600 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              drag.dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            <Grip />
          </span>
          <div className="min-w-0 flex-1">{headerInfo}</div>
          <span className="flex shrink-0 items-center gap-0.5">
            <HeaderIconButton onClick={drag.dock} label="Dock source viewer" title="Dock to the right edge">
              <DockIcon />
            </HeaderIconButton>
            <HeaderIconButton onClick={onClose} label="Close source viewer" title="Close">
              <X size={14} />
            </HeaderIconButton>
          </span>
        </header>
        {body}
      </aside>
    );
  }

  // Docked mode (default): the full-height, resizable right dock.
  return (
    <aside
      role="region"
      aria-label={`Source for ${title}`}
      style={{ width }}
      className={`absolute inset-y-0 right-0 z-20 flex border-l border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur ${
        resizing ? "" : "transition-[width] duration-150 motion-reduce:transition-none"
      }`}
    >
      <DockResizeHandle handleProps={handleProps} resizing={resizing} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-start justify-between gap-2 border-b border-zinc-800 px-4 py-3">
          {headerInfo}
          <span className="-mr-1 -mt-1 flex shrink-0 items-center gap-0.5">
            <HeaderIconButton onClick={drag.float} label="Float source viewer" title="Pop out as a draggable panel">
              <FloatIcon />
            </HeaderIconButton>
            <HeaderIconButton onClick={onClose} label="Close source viewer" title="Close">
              <X size={14} />
            </HeaderIconButton>
          </span>
        </header>
        {body}
      </div>
    </aside>
  );
}

// FR-64 — the source-unavailable state, redesigned. Source bytes are deliberately
// host-local (AD-16) and the hosted plane is source-blind (AD-14), so a node's
// code legitimately isn't in this page. Rather than a dead-end "not available"
// message, this frames that as the privacy guarantee it is and always offers the
// next step: open the real file in the editor when the host owns the code (FR-32),
// or guidance to read source locally otherwise. The signature is shown as what we
// DO know about the node.
function UnavailableCard({
  signature,
  editorLink,
  editorLabel,
  onEditorOpen,
}: {
  signature?: string;
  editorLink: string | null;
  editorLabel: string;
  onEditorOpen: (e: React.MouseEvent) => void;
}): React.JSX.Element {
  // The host owns the code (the webview posted its repo root) → the file is on
  // this machine and we can hand it off, even though its bytes aren't in the page.
  const hostOwnsCode = editorLink != null;
  return (
    <div
      data-testid="source-unavailable"
      className="flex h-full flex-col items-center justify-center gap-4 px-8 py-10 text-center"
    >
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-2xl border border-violet-500/20 bg-violet-500/10 text-violet-300"
      >
        <ShieldCheck size={22} />
      </span>

      <div className="space-y-1.5">
        <h3 className="font-display text-sm font-semibold text-zinc-100">
          {hostOwnsCode ? "Source stays on your machine" : "This view is source-blind"}
        </h3>
        <p className="mx-auto max-w-xs text-xs leading-relaxed text-zinc-400">
          {hostOwnsCode ? (
            <>
              codegraph never sends your code to the browser — it stays host-local. The file is
              right here on your machine; open it in {editorLabel} to read it.
            </>
          ) : (
            <>
              This hosted view receives only the graph’s structure, never your code. Open this graph
              in the VS Code extension or <span className="font-mono text-zinc-300">codegraph serve</span>{" "}
              to read source inline.
            </>
          )}
        </p>
      </div>

      {editorLink && (
        <a
          href={editorLink}
          onClick={onEditorOpen}
          data-testid="open-in-editor"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <ArrowUpRight />
          Open in {editorLabel}
        </a>
      )}

      {signature && (
        <div className="w-full max-w-md">
          <div className="mb-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Signature
          </div>
          <pre className="max-w-full overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-zinc-300">
            {signature}
          </pre>
        </div>
      )}
    </div>
  );
}

// A compact header control (float / dock / close), styled like the detail panel's.
function HeaderIconButton({
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

function Grip(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0" aria-hidden="true">
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

/** A small external-open glyph for the "open in editor" affordance. */
function ArrowUpRight(): React.JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}
