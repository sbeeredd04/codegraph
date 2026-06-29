import Link from "next/link";
import { listDocs } from "@/lib/docs-content";
import { DocsNav } from "@/components/docs-nav";

// Shared chrome for the docs section: a consistent top nav (Explorer · Docs ·
// GitHub), a sidebar listing the guides, and the footer. A server component — the
// guide list is read from disk at build time. Source-blind (AD-14): pure first-
// party content, no graph snapshot, no source, no host path.
//
// Wrapped in a `(docs)` route group so the section shares this layout WITHOUT
// nesting the guide URLs. Guides live at the root (`/getting-started`, …) rather
// than `/docs/getting-started`: the export ships ONE bundle with a relative asset
// prefix (assetPrefix ".") so it can mount under the web sub-path AND the VS Code
// webview's per-session origin. A two-segment route would emit `out/docs/<x>.html`,
// whose `./_next/…` assets resolve against `out/docs/` (404) on a direct load.
// Single-segment routes keep every page's assets mount-agnostic.

const REPO_URL = "https://github.com/sbeeredd04/codegraph";

function Wordmark(): React.JSX.Element {
  return (
    <Link href="/docs" prefetch={false} className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="inline-block size-3.5 rounded-[4px] bg-gradient-to-br from-violet-400 to-cyan-400"
      />
      <span className="font-display text-base font-semibold tracking-tight text-zinc-50">codegraph</span>
    </Link>
  );
}

const navLink =
  "rounded text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]";

export default function DocsLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const docs = listDocs();
  return (
    <main className="flex-1 bg-[#0a0a0a] font-sans text-zinc-300">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav aria-label="Primary" className="flex items-center gap-5 text-sm">
          <Link href="/" prefetch={false} className={navLink}>
            Explorer
          </Link>
          <Link href="/docs" prefetch={false} className={`${navLink} text-zinc-100`}>
            Docs
          </Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={navLink}>
            GitHub
          </a>
        </nav>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="md:sticky md:top-10 md:self-start">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Guides</p>
          <DocsNav docs={docs} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>

      <footer className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col items-center justify-between gap-3 border-t border-zinc-900 pt-8 text-xs text-zinc-500 sm:flex-row">
          <Wordmark />
          <p className="font-mono">read-only · source-host-local · no LLM key in-app</p>
        </div>
      </footer>
    </main>
  );
}
