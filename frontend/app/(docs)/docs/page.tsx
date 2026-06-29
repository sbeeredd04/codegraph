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

      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {docs.map((d) => (
          <li key={d.slug}>
            <Link
              href={`/${d.slug}`}
              prefetch={false}
              className="block h-full rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
            >
              <h2 className="font-display text-base font-semibold text-zinc-100">{d.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{d.summary}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-300">
                Read
                <span aria-hidden>→</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
