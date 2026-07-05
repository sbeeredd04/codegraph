"use client";

// Progressive enhancement for the first-party docs website (T13.1 — Mermaid in
// Markdown). The build-time renderer emits ```mermaid fences as `.cg-mermaid`
// placeholders carrying the escaped source (see lib/docs-content.ts). After
// hydration this finds each placeholder and upgrades it to a strict, CSP-safe SVG
// via the shared renderer. With JS off (or before hydration) the placeholder is a
// readable code block, so the docs still read — the diagram is pure enhancement.
//
// It renders nothing itself: it's an effect host mounted beside the prose. The
// prose lives in a `dangerouslySetInnerHTML` div React sets once and never
// re-renders, so mutating the placeholders' innerHTML here is stable — React won't
// clobber it. Idempotent: the `data-cg-mermaid` gate means a re-run (e.g. React
// strict-mode double-invoke) skips already-upgraded slots.

import { useEffect } from "react";
import { renderMermaid } from "@/lib/render-mermaid";

export function DocsMermaid(): null {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const slots = Array.from(document.querySelectorAll<HTMLElement>(".cg-mermaid[data-cg-mermaid]"));
      for (const slot of slots) {
        if (cancelled) return;
        const source = slot.querySelector(".cg-mermaid-src")?.textContent ?? "";
        if (!source.trim()) continue;
        try {
          const svg = await renderMermaid(source);
          if (cancelled) return;
          slot.innerHTML = svg;
          slot.removeAttribute("data-cg-mermaid");
          slot.setAttribute("data-cg-mermaid-done", "");
        } catch {
          // Leave the readable source in place on failure — better than a blank box.
          slot.removeAttribute("data-cg-mermaid");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
