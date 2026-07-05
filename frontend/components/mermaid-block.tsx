"use client";

// Shared inline Mermaid renderer (T13.2) — one <MermaidBlock source /> that turns a
// diagram source into a strict, CSP-safe SVG via the shared renderer. Used wherever
// Mermaid appears INSIDE flowing Markdown (the agent docs drawer today; any future
// Markdown surface). Mounted fresh per block (parents key it), so its initial state
// is "rendering" and the effect only setStates in async continuations.
//
// SECURITY: the SVG comes from mermaid securityLevel:"strict" (it DOMPurify-
// sanitizes its OWN output, no <script>/eval), so it is injected directly here and
// NEVER routed through the surrounding prose's DOMPurify allowlist — the untrusted
// prose stays sanitized exactly as before, and the allowlist is never widened to
// admit <svg>. On failure the raw source stays visible (readable), never a blank box.

import { useEffect, useState } from "react";
import { renderMermaid } from "@/lib/render-mermaid";

type State =
  | { readonly status: "rendering" }
  | { readonly status: "ok"; readonly svg: string }
  | { readonly status: "error" };

export function MermaidBlock({ source }: { source: string }): React.JSX.Element {
  const [state, setState] = useState<State>({ status: "rendering" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const svg = await renderMermaid(source);
        if (!cancelled) setState({ status: "ok", svg });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state.status === "rendering") {
    return <p className="my-3 text-xs text-zinc-500">Rendering diagram…</p>;
  }
  if (state.status === "error") {
    // Readable fallback — the source is more useful than an empty frame.
    return <pre className="cg-mermaid-src my-3 overflow-x-auto rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-400">{source}</pre>;
  }
  // Strict mermaid output is DOMPurify-sanitized static SVG (no scripts) — safe to
  // inject and CSP-clean (no eval). `.cg-mermaid` centers + bounds it (globals.css).
  return (
    <div
      className="cg-mermaid"
      data-cg-mermaid-done
      data-testid="doc-mermaid"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
