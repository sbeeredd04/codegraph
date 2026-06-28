"use client";

// Read-only source-code viewer for a selected node (FR-15) — the "spaceship
// dashboard" code panel. Source bytes arrive over the `SourceText` contract,
// host-LOCAL only (AD-16): here that means fetching the first-party sidecar a
// local/static build ships. When no source is available (hosted plane, or a
// third-party graph with no bundled source) it degrades to a clear card rather
// than failing. Strictly passive — no textarea, no contentEditable, no edit
// affordance of any kind (FR-9). Tokens render as escaped React spans, so
// untrusted source can never inject markup.

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSourceView } from "@core/source/source-view";
import { buildEditorLink, editorById, DEFAULT_EDITOR } from "@core/links/editor-link";
import { tokenizeLines, type Token, type TokenType } from "@/lib/highlight";

const TOKEN_CLASS: Record<TokenType, string> = {
  plain: "text-zinc-300",
  comment: "text-zinc-500 italic",
  string: "text-emerald-300",
  keyword: "text-violet-300",
  number: "text-amber-300",
};

type Loaded = { lines: Token[][]; anchor: number; lineCount: number };
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
  onClose,
}: NodeSourceViewerProps): React.JSX.Element {
  // Lazy initial state: "unavailable" up front when this host serves no source,
  // else "loading" until the fetch resolves. The parent keys this component on
  // (sourceBase, file, line) so a new node remounts it — which is why the effect
  // never needs a synchronous reset (that would cause a cascading render).
  const [state, setState] = useState<ViewState>(() =>
    sourceBase ? { status: "loading" } : { status: "unavailable" },
  );
  const anchorRef = useRef<HTMLDivElement | null>(null);

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
        setState({ status: "ready", data: { lines: tokenizeLines(text), anchor: view.anchor, lineCount: view.lineCount } });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [sourceBase, file, line]);

  // Center the def line once the code is in the DOM.
  useEffect(() => {
    if (state.status === "ready") anchorRef.current?.scrollIntoView({ block: "center" });
  }, [state]);

  // Esc closes the viewer (returns to the detail panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const gutterWidth = useMemo(
    () => (state.status === "ready" ? String(state.data.lineCount).length : 2),
    [state],
  );

  // "Open in editor" deep link (FR-32). buildEditorLink returns null unless the
  // host gave us an absolute root, so this is naturally withheld on the
  // source-blind web/cloud and present inside the VS Code webview.
  const editorLink = useMemo(
    () => buildEditorLink({ root: editorRoot, file, line, column: character }),
    [editorRoot, file, line, character],
  );
  const editorLabel = editorById(DEFAULT_EDITOR).label;

  return (
    <aside
      role="region"
      aria-label={`Source for ${title}`}
      className="absolute inset-y-3 right-3 z-20 flex w-[min(44rem,60vw)] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur"
    >
      <header className="flex items-start justify-between gap-2 border-b border-zinc-800 px-4 py-3">
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
          {editorLink && (
            <a
              href={editorLink}
              data-testid="open-in-editor"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <ArrowUpRight />
              Open in {editorLabel}
            </a>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close source viewer"
          className="-mr-1 -mt-1 rounded p-1 text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-[#0b0c10]">
        {state.status === "loading" && (
          <div className="grid h-full place-items-center text-xs text-zinc-600">Loading source…</div>
        )}

        {state.status === "unavailable" && (
          <UnavailableCard signature={signature} editorLink={editorLink} editorLabel={editorLabel} />
        )}

        {state.status === "error" && (
          <div className="grid h-full place-items-center px-6 text-center text-xs text-zinc-500">
            Couldn’t read this file.
          </div>
        )}

        {state.status === "ready" && (
          <pre className="m-0 font-mono text-[12px] leading-[1.55]">
            <code className="block">
              {state.data.lines.map((tokens, idx) => {
                const isAnchor = idx === state.data.anchor;
                return (
                  <div
                    key={idx}
                    ref={isAnchor ? anchorRef : undefined}
                    className={`flex ${isAnchor ? "bg-violet-500/10" : ""}`}
                  >
                    <span
                      aria-hidden
                      style={{ width: `${gutterWidth + 1}ch` }}
                      className={`sticky left-0 select-none border-r border-zinc-800/80 bg-[#0b0c10] px-3 text-right ${
                        isAnchor ? "text-violet-300" : "text-zinc-600"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="whitespace-pre px-3">
                      {tokens.length === 0 ? (
                        " "
                      ) : (
                        tokens.map((t, k) => (
                          <span key={k} className={TOKEN_CLASS[t.type]}>
                            {t.value}
                          </span>
                        ))
                      )}
                    </span>
                  </div>
                );
              })}
            </code>
          </pre>
        )}
      </div>
    </aside>
  );
}

function UnavailableCard({
  signature,
  editorLink,
  editorLabel,
}: {
  signature?: string;
  editorLink: string | null;
  editorLabel: string;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-sm font-medium text-zinc-300">Source not available here</div>
      <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
        Source is read on the machine that owns the code — the VS Code extension or
        <span className="font-mono"> codegraph serve</span>. The hosted demo stays
        source-blind, so it shows the signature instead.
      </p>
      {/* When the host gave us its repo root (FR-32), the source isn't in this
          page but we can still hand the file off to the real editor. */}
      {editorLink && (
        <a
          href={editorLink}
          data-testid="open-in-editor"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <ArrowUpRight />
          Open in {editorLabel}
        </a>
      )}
      {signature && (
        <pre className="mt-1 max-w-full overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-zinc-300">
          {signature}
        </pre>
      )}
    </div>
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
