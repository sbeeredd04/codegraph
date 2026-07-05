"use client";

// Knowledge docs drawer (Epic 7 / FR-29) — the prose companion to the diagrams
// drawer. The connected agent authors long-form Markdown about a repo (save_doc)
// that rides on the GraphSnapshot; this lists docs by category and renders the
// selected one as sanitized HTML.
//
// SECURITY: the doc Markdown is agent-written and therefore UNTRUSTED. Rendering is
// delegated to the shared <AgentMarkdown>, which parses with marked, SANITIZES with
// DOMPurify against a strict allowlist, and lifts ```mermaid fences into separate
// strict SVGs — the one security-critical Markdown path, shared with the detail
// panel's grounding note. The only non-web scheme permitted is our own
// `codegraph://node/<address>` deep-link, intercepted in-app (never navigated).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Doc } from "@core/docs/doc";
import { docsByCategory } from "@core/docs/doc";
import type { GraphNode } from "@core/graph/types";
import { displayLabel } from "@adapters/surfaces/webview/render-model";
import { ResizableDock } from "./resizable-dock";
import { AgentMarkdown } from "./agent-markdown";

interface DocsDrawerProps {
  readonly docs: readonly Doc[];
  /** Address → node, for labelling the "related" cross-highlight chips. */
  readonly byAddress: ReadonlyMap<string, GraphNode>;
  /** Jump to a node in the graph (select + pan) — drives the FR-25 focus lens. */
  readonly onJump: (address: string) => void;
  readonly onClose: () => void;
}

export function DocsDrawer({ docs, byAddress, onJump, onClose }: DocsDrawerProps): React.JSX.Element {
  const groups = useMemo(
    () => Array.from(docsByCategory({ version: 1, docs }), ([category, list]) => ({ category, list })),
    [docs],
  );
  const [activeId, setActiveId] = useState<string | null>(docs[0]?.id ?? null);
  const active = useMemo(() => docs.find((d) => d.id === activeId) ?? null, [docs, activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const jump = useCallback(
    (address: string) => {
      onJump(address);
      onClose();
    },
    [onJump, onClose],
  );

  const empty = docs.length === 0;

  return (
    <ResizableDock
      storageKey="codegraph:dock:docs"
      side="left"
      bounds={{ defaultWidth: 576, minWidth: 380, maxWidth: 820 }}
      label="Docs"
      role="dialog"
      ariaLabel="Knowledge docs"
      floatKey="codegraph:panel:docs"
      surfaceClassName="bg-[#0c0d11]/97 shadow-2xl backdrop-blur"
      scrollBody={false}
      inset
      railAccent={<span aria-hidden className="text-sm text-zinc-500">¶</span>}
    >
      <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-sm">¶</span>
          <h2 className="font-display text-sm font-semibold tracking-tight text-zinc-50">Docs</h2>
          <span className="font-mono text-xs text-zinc-500">{docs.length}</span>
        </div>
        <button onClick={onClose} aria-label="Close docs" className="rounded p-1 text-zinc-500 hover:text-zinc-200">
          ✕
        </button>
      </header>

      {empty ? (
        <EmptyState />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <nav aria-label="Doc index" className="max-h-44 overflow-auto border-b border-zinc-800 px-3 py-2">
            {groups.map((g) => (
              <div key={g.category} className="mb-2 last:mb-0">
                <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {g.category} <span className="font-mono text-zinc-600">{g.list.length}</span>
                </div>
                <ul className="flex flex-col gap-0.5">
                  {g.list.map((d) => (
                    <li key={d.id}>
                      <button
                        onClick={() => setActiveId(d.id)}
                        aria-current={d.id === activeId}
                        className={`w-full truncate rounded px-2 py-1 text-left text-xs transition-colors ${
                          d.id === activeId
                            ? "bg-violet-500/15 text-violet-200"
                            : "text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50"
                        }`}
                        title={d.title}
                      >
                        {d.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-auto p-5">
            {active && (
              <>
                <h3 className="font-display text-lg font-semibold text-zinc-50">{active.title}</h3>
                {/* Keyed by id so each doc mounts fresh in the "rendering" state. */}
                <div className="mt-3">
                  <AgentMarkdown key={active.id} markdown={active.markdown} onJump={jump} testId="doc-html" />
                </div>
                <RelatedChips related={active.related} byAddress={byAddress} onJump={jump} />
              </>
            )}
          </div>
        </div>
      )}
    </ResizableDock>
  );
}

function RelatedChips({
  related,
  byAddress,
  onJump,
}: {
  related: readonly string[] | undefined;
  byAddress: ReadonlyMap<string, GraphNode>;
  onJump: (address: string) => void;
}): React.JSX.Element | null {
  if (!related || related.length === 0) return null;
  return (
    <div className="mt-5 border-t border-zinc-800 pt-4">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Related nodes</div>
      <div className="flex flex-wrap gap-1.5">
        {related.map((addr) => {
          const n = byAddress.get(addr);
          return (
            <button
              key={addr}
              onClick={() => onJump(addr)}
              title={addr}
              className="rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-200"
            >
              {n ? displayLabel(n.name, n.kind) : addr.split(/[#:]/).pop()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div aria-hidden className="mb-3 text-2xl text-zinc-700">¶</div>
      <p className="text-sm font-medium text-zinc-300">No docs yet</p>
      <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-500">
        Connect your AI agent over MCP and ask it to document this repo. As it explores the
        graph it calls <code className="font-mono text-zinc-400">save_doc</code> to write
        onboarding guides and module deep-dives — they appear here.
      </p>
    </div>
  );
}
