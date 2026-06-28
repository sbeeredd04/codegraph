"use client";

// AI-assist "Ask" panel (FR-30). codegraph never calls an LLM — the user's OWN
// connected agent (Claude Code / Codex over the codegraph MCP) does the work.
// This panel turns a question + the current graph selection into a ready-to-run
// prompt (built by the pure core buildAskPrompt) and copies it to the clipboard,
// so the user pastes it into their agent. No network, no key, no source leaves
// the host — it is a local-plane affordance, withheld on the source-blind cloud
// demo (the Explorer gates mounting on assistEnabled).
//
// The generated prompt is shown live in a read-only preview so the user sees
// exactly what they'll paste (transparency), and the copy is a convenience.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildAskPrompt, type AskFocus } from "@core/assist/ask";

interface AskPanelProps {
  /** The selected node, if any — anchors the agent's exploration. */
  readonly focus: AskFocus | null;
  /** First-degree neighbour addresses of the focus. */
  readonly neighbours: readonly string[];
  /** Repo root / dataset label, for provenance. */
  readonly root?: string;
  readonly onClose: () => void;
}

export function AskPanel({ focus, neighbours, root, onClose }: AskPanelProps): React.JSX.Element {
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  const prompt = useMemo(
    () => buildAskPrompt({ question, focus: focus ?? undefined, neighbours, root }),
    [question, focus, neighbours, root],
  );

  const copy = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        // Clipboard API unavailable (insecure context) — the preview is selectable
        // as a fallback, so the prompt is never out of reach.
        setCopied(false);
      }
    })();
  }, [prompt]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Ask your agent"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0d11] shadow-2xl"
      >
        <div className="border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-sm">✦</span>
            <h2 className="font-display text-sm font-semibold tracking-tight text-zinc-50">Ask your agent</h2>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
            codegraph keeps no AI key — your own connected agent answers. This builds a prompt grounded
            in the graph; paste it into Claude Code, Codex, or any MCP client wired to codegraph.
          </p>
        </div>

        <div className="px-5 py-4">
          {focus && (
            <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-400">
              <span className="text-zinc-500">Context:</span>
              <span className="font-mono text-zinc-300">{focus.name}</span>
              <span className="text-zinc-600">{focus.kind}</span>
            </div>
          )}
          <label htmlFor="ask-q" className="sr-only">
            Your question about this codebase
          </label>
          <textarea
            id="ask-q"
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="What do you want to understand? e.g. How does a request flow from the extension to the graph core?"
            className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          />

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Generated prompt
              </span>
              <button
                onClick={copy}
                className="rounded-md border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </div>
            <pre
              data-testid="ask-prompt"
              className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-400"
            >
              {prompt}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
