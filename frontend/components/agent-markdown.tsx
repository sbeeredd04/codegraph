"use client";

// Shared renderer for agent-authored (UNTRUSTED) Markdown (T13.3) — used wherever
// such content appears in the UI: the knowledge docs drawer and the node detail
// panel's grounding note. ONE security-critical path:
//   • prose runs are parsed with marked and SANITIZED with DOMPurify against a
//     strict tag/attr allowlist (no script/style/iframe/img, no event handlers, no
//     javascript: URLs). The only non-web scheme permitted is codegraph://node/.
//   • ```mermaid fences are lifted out BEFORE sanitizing and rendered as separate
//     strict <MermaidBlock> SVGs, so a diagram's SVG never passes through — nor
//     widens — the prose allowlist.
// Splitting at top-level fenced-code tokens is safe: a fence is always its own
// top-level token, so no Markdown construct spans the boundary. marked + DOMPurify
// are dynamic-imported (client-only, off the boot path). When onJump is given, a
// codegraph://node/<address> link click is intercepted and focuses the node
// instead of navigating.

import { useCallback, useEffect, useState } from "react";
import { MermaidBlock } from "./mermaid-block";

const NODE_LINK_PREFIX = "codegraph://node/";

// Strict allowlist for sanitized agent Markdown — prose tags only.
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr", "blockquote",
  "ul", "ol", "li",
  "strong", "em", "del", "code", "pre",
  "a", "span",
  "table", "thead", "tbody", "tr", "th", "td",
];
const ALLOWED_ATTR = ["href", "title", "start", "align"];
// Permit http(s)/mailto/tel, our internal node scheme, anchors and relative refs;
// blocks javascript:, data:, vbscript:, etc.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|codegraph):|[#/.])/i;

type Block = { readonly kind: "prose"; readonly html: string } | { readonly kind: "mermaid"; readonly source: string };
type RenderState =
  | { readonly status: "rendering" }
  | { readonly status: "ok"; readonly blocks: readonly Block[] }
  | { readonly status: "error"; readonly message: string };

export function AgentMarkdown({
  markdown,
  onJump,
  proseClassName = "doc-prose",
  testId,
}: {
  readonly markdown: string;
  readonly onJump?: (address: string) => void;
  readonly proseClassName?: string;
  readonly testId?: string;
}): React.JSX.Element {
  const [state, setState] = useState<RenderState>({ status: "rendering" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ marked }, DOMPurifyMod] = await Promise.all([import("marked"), import("dompurify")]);
        const DOMPurify = DOMPurifyMod.default;
        const sanitizeProse = async (md: string): Promise<string> => {
          const dirty = await marked.parse(md, { gfm: true, breaks: false });
          return DOMPurify.sanitize(dirty, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP, ALLOW_DATA_ATTR: false });
        };
        // Group consecutive non-mermaid tokens into a prose run (re-parsed +
        // sanitized as one); lift each ```mermaid fence into its own diagram block.
        const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
        const blocks: Block[] = [];
        let proseRaw = "";
        const flushProse = async (): Promise<void> => {
          if (!proseRaw) return;
          blocks.push({ kind: "prose", html: await sanitizeProse(proseRaw) });
          proseRaw = "";
        };
        for (const t of tokens) {
          if (t.type === "code" && (t.lang ?? "").trim().toLowerCase() === "mermaid") {
            await flushProse();
            blocks.push({ kind: "mermaid", source: t.text });
          } else {
            proseRaw += t.raw;
          }
        }
        await flushProse();
        if (!cancelled) setState({ status: "ok", blocks });
      } catch (e: unknown) {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markdown]);

  // Intercept clicks on internal node deep-links so they focus the node in the
  // graph instead of navigating; external links keep their normal behaviour.
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onJump) return;
      const anchor = (e.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href") ?? "";
      if (href.startsWith(NODE_LINK_PREFIX)) {
        e.preventDefault();
        onJump(decodeURIComponent(href.slice(NODE_LINK_PREFIX.length)));
      }
    },
    [onJump],
  );

  if (state.status === "rendering") {
    return <p className="text-xs text-zinc-500">Rendering…</p>;
  }
  if (state.status === "error") {
    return (
      <div>
        <p className="text-xs text-red-300">Could not render this content.</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-400">
          {markdown}
        </pre>
      </div>
    );
  }
  return (
    // Prose runs are DOMPurify-sanitized (strict allowlist, no scripts, no svg);
    // mermaid blocks are strict self-sanitized SVGs rendered separately. onJump
    // catches codegraph://node deep-links bubbling from any prose block.
    <div data-testid={testId} onClick={onJump ? onClick : undefined}>
      {state.blocks.map((b, i) =>
        b.kind === "prose" ? (
          <div key={`p${i}`} className={proseClassName} dangerouslySetInnerHTML={{ __html: b.html }} />
        ) : (
          <MermaidBlock key={`m${i}`} source={b.source} />
        ),
      )}
    </div>
  );
}
