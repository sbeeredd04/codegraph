"use client";

// Knowledge diagrams drawer (Epic 7 / FR-28) — parity port of the bespoke
// webview's diagram drawer onto the Next explorer. The connected agent authors
// categorized Mermaid diagrams (save_diagram) that ride on the GraphSnapshot;
// this lists them by category and renders the selected one as an SVG.
//
// SECURITY: the diagram titles/descriptions/categories are agent-written and
// therefore UNTRUSTED — they are interpolated as React children, which escapes
// them. The Mermaid SOURCE is handed ONLY to mermaid.render() with
// securityLevel:"strict" (DOMPurify-sanitized output, no script/eval), never to
// innerHTML directly. Mermaid is dynamically imported so it stays client-only
// and out of the boot path until the user opens the drawer.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Diagram } from "@core/diagrams/diagram";
import { diagramsByCategory } from "@core/diagrams/diagram";
import type { GraphNode } from "@core/graph/types";
import { displayLabel } from "@adapters/surfaces/webview/render-model";

interface DiagramsDrawerProps {
  readonly diagrams: readonly Diagram[];
  /** Address → node, for labelling the "related" cross-highlight chips. */
  readonly byAddress: ReadonlyMap<string, GraphNode>;
  /** Jump to a node in the graph (select + pan) — drives the FR-25 focus lens. */
  readonly onJump: (address: string) => void;
  readonly onClose: () => void;
}

// Monotonic id source for mermaid.render targets (must be DOM-id safe + unique
// per render). A module counter is deterministic enough and avoids needing a key.
let renderSeq = 0;

type RenderState =
  | { readonly status: "rendering" }
  | { readonly status: "ok"; readonly svg: string }
  | { readonly status: "error"; readonly message: string };

export function DiagramsDrawer({
  diagrams,
  byAddress,
  onJump,
  onClose,
}: DiagramsDrawerProps): React.JSX.Element {
  const groups = useMemo(
    () => Array.from(diagramsByCategory({ version: 1, diagrams }), ([category, list]) => ({ category, list })),
    [diagrams],
  );
  const [activeId, setActiveId] = useState<string | null>(diagrams[0]?.id ?? null);

  const active = useMemo(
    () => diagrams.find((d) => d.id === activeId) ?? null,
    [diagrams, activeId],
  );

  // Esc closes the drawer.
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

  const empty = diagrams.length === 0;

  return (
    <aside
      role="dialog"
      aria-label="Knowledge diagrams"
      className="absolute inset-y-0 left-0 z-20 flex w-[min(34rem,46vw)] flex-col border-r border-zinc-800 bg-[#0c0d11]/97 shadow-2xl backdrop-blur"
    >
      <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-sm">◇</span>
          <h2 className="font-display text-sm font-semibold tracking-tight text-zinc-50">Diagrams</h2>
          <span className="font-mono text-xs text-zinc-500">{diagrams.length}</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close diagrams"
          className="rounded p-1 text-zinc-500 hover:text-zinc-200"
        >
          ✕
        </button>
      </header>

      {empty ? (
        <EmptyState />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Category index */}
          <nav aria-label="Diagram index" className="max-h-44 overflow-auto border-b border-zinc-800 px-3 py-2">
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

          {/* Render area */}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {active && (
              <>
                <h3 className="font-display text-base font-semibold text-zinc-50">{active.title}</h3>
                {active.description && (
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{active.description}</p>
                )}

                {/* Keyed by id so each diagram gets a fresh mount that starts in
                    the "rendering" state — no synchronous setState in an effect. */}
                <DiagramRender key={active.id} source={active.mermaid} />

                <RelatedChips
                  related={active.related}
                  byAddress={byAddress}
                  onJump={jump}
                />
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

// Renders one Mermaid source to an SVG. Mounted fresh per diagram (the parent
// keys it by id), so its initial state is "rendering" and the effect only calls
// setState inside async continuations — satisfying the no-setState-in-effect rule.
function DiagramRender({ source }: { source: string }): React.JSX.Element {
  const [state, setState] = useState<RenderState>({ status: "rendering" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          fontFamily: "var(--font-sans, ui-sans-serif), system-ui, sans-serif",
        });
        const { svg } = await mermaid.render(`dg-${renderSeq++}`, source);
        if (!cancelled) setState({ status: "ok", svg });
      } catch (e: unknown) {
        if (!cancelled) {
          setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      {state.status === "rendering" && <p className="text-xs text-zinc-500">Rendering diagram…</p>}
      {state.status === "error" && (
        <div>
          <p className="text-xs text-red-300">Could not render this diagram.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
            {source}
          </pre>
        </div>
      )}
      {state.status === "ok" && (
        // mermaid strict output is DOMPurify-sanitized static SVG (no scripts) —
        // safe to inject and CSP-clean (no eval).
        <div
          className="dg-svg overflow-x-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          data-testid="diagram-svg"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
    </div>
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
    <div className="mt-4">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Related nodes
      </div>
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

// Onboarding empty state — a repo with no diagrams yet is the common first-run
// case (an agent hasn't mapped it). A blank panel reads as broken; this tells
// the human exactly how diagrams appear.
function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div aria-hidden className="mb-3 text-2xl text-zinc-700">◇</div>
      <p className="text-sm font-medium text-zinc-300">No diagrams yet</p>
      <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-500">
        Connect your AI agent over MCP and ask it to map this repo. As it explores the
        graph it calls <code className="font-mono text-zinc-400">save_diagram</code> to author
        workflow, architecture, and sequence diagrams — they appear here.
      </p>
    </div>
  );
}
