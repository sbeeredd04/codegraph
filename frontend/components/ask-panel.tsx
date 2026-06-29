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
import { Sparkles } from "./icons";

// Intent presets — one click prefills a grounded, ready-to-refine question so the
// affordance is never a blank page. Each adapts to whether a node is selected, so
// the question names the focus when there is one and asks about the whole codebase
// when there isn't. They only set the textarea; the live preview rebuilds from it.
const ASK_PRESETS: readonly { readonly label: string; readonly q: (f: AskFocus | null) => string }[] = [
  {
    label: "Explain this",
    q: (f) =>
      f
        ? `Explain what ${f.name} does, how it works, and how it fits into the wider codebase.`
        : "Explain this codebase's architecture and the main flows through it.",
  },
  {
    label: "Trace the flow",
    q: (f) =>
      f
        ? `Trace the flow through ${f.name}: what calls it, what it calls, and the end-to-end path on both sides.`
        : "Trace the main request and data flows end to end across this codebase.",
  },
  {
    label: "Find risks",
    q: (f) =>
      f
        ? `Review ${f.name} for bugs, edge cases, and risky dependencies — what could break, and where?`
        : "Find the riskiest areas of this codebase: fragile hotspots, tight coupling, and missing checks.",
  },
  {
    label: "Summarize area",
    q: (f) =>
      f
        ? `Summarize the area around ${f.name}: its responsibilities, neighbours, and the key types involved.`
        : "Give a high-level map of this codebase — the major modules and how they relate.",
  },
];

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

  const applyPreset = useCallback((q: string) => {
    setQuestion(q);
    inputRef.current?.focus();
  }, []);

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
            <Sparkles size={14} className="text-violet-300" aria-hidden />
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
          <div
            role="group"
            aria-label="Question presets"
            className="mb-2.5 flex flex-wrap gap-1.5"
          >
            {ASK_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.q(focus))}
                className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                {p.label}
              </button>
            ))}
          </div>
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
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Sparkles size={11} className="shrink-0 text-violet-400/70" aria-hidden />
              Paste into your agent&apos;s chat — it answers from the live graph and saves a diagram or doc back to the board.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
