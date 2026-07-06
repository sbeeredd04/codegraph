import type { Metadata } from "next";
import Link from "next/link";
import { listDocs } from "@/lib/docs-content";

// /docs — the overview that introduces the guides and links into each. A server
// component, prerendered to static HTML at build (no client JS). Single-segment
// route → emits out/docs.html at the export root, so its relative assets resolve
// under any mount.

export const metadata: Metadata = {
  title: "Docs — codegraph",
  description: "Guides for codegraph: getting started, how it works, and how to use the explorer.",
};

export default function DocsIndex(): React.JSX.Element {
  const docs = listDocs();
  return (
    <article>
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-50">Documentation</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
        codegraph maps a codebase into a live, navigable graph beside your editor — and exposes that same
        graph to the AI agent you already use. These guides take you from install to a fully driven board.
      </p>

      {/* Signpost the reading order for a first-run visitor (they often arrive from the
          board's first-run hint) — the guides are meant to be read in sequence. */}
      <ol className="mt-10 grid gap-4 sm:grid-cols-2">
        {docs.map((d, i) => {
          const isFirst = i === 0;
          return (
            <li key={d.slug}>
              <Link
                href={`/${d.slug}`}
                prefetch={false}
                className="group block h-full rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold tabular-nums ${
                      isFirst ? "bg-violet-500/20 text-violet-200" : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <h2 className="font-display text-base font-semibold text-zinc-100">{d.title}</h2>
                  {isFirst && (
                    <span className="ml-auto rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-200">
                      Start here
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{d.summary}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-300">
                  Read
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
