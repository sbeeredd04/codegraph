import type { Metadata } from "next";
import Link from "next/link";

// FR-35 landing page (Epic 18.2): the entry/marketing surface — a cloud-plane,
// Vercel-deployable route that tells the codegraph story and routes people into
// the product. It is its OWN route (`/welcome`); the explorer keeps `/`, which is
// what the VS Code webview loads, so this page never reaches the webview.
//
// SOURCE-BLIND by construction (AD-14): it bundles NO graph snapshot and NO source
// — every visual here is decorative, invented markup, not real code. MOUNT-AGNOSTIC:
// internal links are root-relative so the export resolves them under any origin.
// A server component: pure static content, prerendered to HTML at build (no client
// JS beyond link prefetch), which keeps it CSP-friendly and fast. Reuses the FR-33
// type/brand system (font-display / font-sans / font-mono) and the dark shell.

export const metadata: Metadata = {
  title: "codegraph — your codebase as a living map",
  description:
    "An interactive, read-only knowledge graph of your codebase: structure, diagrams, docs, " +
    "and AI-assist powered by your own connected agent. Local-first source, source-blind cloud.",
};

const REPO_URL = "https://github.com/sbeeredd04/codegraph";

interface Feature {
  readonly title: string;
  readonly body: string;
  readonly icon: React.ReactNode;
}

// Small, self-authored line icons (decorative — aria-hidden on each card). Kept
// inline to avoid an icon dependency and to stay same-origin under strict CSP.
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const FEATURES: readonly Feature[] = [
  {
    title: "A navigable graph",
    body: "Every module, class, function, and method as nodes, with calls, dependencies, and containment as edges. Focus a node and its neighbourhood lifts out of the hairball.",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
        <circle cx="6" cy="7" r="2.2" />
        <circle cx="18" cy="6" r="2.2" />
        <circle cx="12" cy="17" r="2.2" />
        <path d="M8 8.4 10.6 15M16.4 7.6 13.4 15.2M8 7.4h8" />
      </svg>
    ),
  },
  {
    title: "Diagrams & docs",
    body: "Your connected agent explores the graph and writes back Mermaid diagrams and Markdown docs — narrative on top of structure — rendered on the board, sanitized and strict.",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M7.5 9h6M7.5 12.5h9M7.5 16h5" />
      </svg>
    ),
  },
  {
    title: "Ask your own agent",
    body: "No LLM key lives in the app — that is the moat. Ask-assist builds a grounded prompt for the agent you already use, which answers from the real graph over the codegraph MCP.",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
        <path d="M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z" />
        <path d="M9 10.5h6" />
      </svg>
    ),
  },
  {
    title: "Agent as co-pilot",
    body: "The agent can drive the live board: highlight nodes, mark hotspots, walk you through a guided tour, even replay a stack trace across the graph — while you keep the wheel.",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 12 16 8.5M12 12l-4 1" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Open in your editor",
    body: "Every node deep-links to its exact file and line. Jump from the map straight into your IDE — path metadata only, the source never leaves your host.",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
        <path d="M9 7.5 4.5 12 9 16.5M15 7.5 19.5 12 15 16.5" />
      </svg>
    ),
  },
  {
    title: "Read-only, always",
    body: "codegraph reads your codebase; it never writes to it. A board you can explore without fear — the source tree is never mutated.",
    icon: (
      <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
        <rect x="5.5" y="10.5" width="13" height="8.5" rx="1.8" />
        <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      </svg>
    ),
  },
];

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="inline-block size-3.5 rounded-[4px] bg-gradient-to-br from-violet-400 to-cyan-400"
      />
      <span className="font-display text-base font-semibold tracking-tight text-zinc-50">codegraph</span>
    </span>
  );
}

const primaryCta =
  "inline-flex items-center justify-center rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white " +
  "transition-colors hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]";
const secondaryCta =
  "inline-flex items-center justify-center rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold " +
  "text-zinc-100 transition-colors hover:border-zinc-500 hover:text-white focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]";

export default function Welcome() {
  return (
    <main className="flex-1 bg-[#0a0a0a] font-sans text-zinc-300">
      {/* Top nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav aria-label="Primary" className="flex items-center gap-5 text-sm">
          <Link
            href="/docs"
            prefetch={false}
            className="text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] rounded"
          >
            Docs
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] rounded"
          >
            GitHub
          </a>
          <Link
            href="/"
            prefetch={false}
            className="text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] rounded"
          >
            Explorer
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section aria-labelledby="hero-heading" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-96 max-w-3xl rounded-full bg-violet-600/20 blur-[120px]"
        />
        <div className="relative mx-auto max-w-3xl px-6 pb-20 pt-16 text-center sm:pt-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 font-mono text-xs text-zinc-400">
            <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
            read-only · source stays on your host
          </p>
          <h1
            id="hero-heading"
            className="font-display text-4xl font-bold leading-[1.08] tracking-tight text-zinc-50 sm:text-6xl"
          >
            Your codebase as a{" "}
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              living map
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            codegraph turns a repository into a navigable knowledge surface — graph, diagrams, docs, and
            AI-assist powered by the agent you already use. A VS Code extension and a web explorer, from one
            codebase.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/" prefetch={false} className={primaryCta}>
              Open the explorer demo
            </Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={secondaryCta}>
              Get the VS Code extension
            </a>
          </div>
        </div>
      </section>

      {/* Two-plane story — the architecture + the moat */}
      <section aria-labelledby="planes-heading" className="mx-auto max-w-5xl px-6 py-16">
        <h2 id="planes-heading" className="text-center font-display text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
          Two planes, one map
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-zinc-400">
          codegraph runs source-host-local, and never sends a byte of your code to the cloud.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="font-mono text-xs uppercase tracking-wider text-violet-300">local plane</p>
            <h3 className="mt-2 font-display text-lg font-semibold text-zinc-100">Source-host-local</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Indexing, parsing, and the source viewer all run on your machine. Your code, and the absolute
              paths to it, stay on the host — open-source and offline-capable.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <p className="font-mono text-xs uppercase tracking-wider text-cyan-300">cloud plane</p>
            <h3 className="mt-2 font-display text-lg font-semibold text-zinc-100">Source-blind</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Only graph identities, structure, and relative path metadata can reach the cloud — never source
              bytes, never an absolute host path. The shareable map carries knowledge about your code, not the
              code.
            </p>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section aria-labelledby="features-heading" className="mx-auto max-w-6xl px-6 py-16">
        <h2 id="features-heading" className="text-center font-display text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
          Everything you need to understand a codebase
        </h2>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-zinc-700"
            >
              <span
                aria-hidden
                className="inline-flex size-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-violet-300"
              >
                {f.icon}
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-zinc-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Closing CTA */}
      <section aria-labelledby="cta-heading" className="mx-auto max-w-5xl px-6 py-16">
        <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/40 px-6 py-14 text-center">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-40 max-w-md rounded-full bg-cyan-500/10 blur-[90px]" />
          <h2 id="cta-heading" className="relative font-display text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
            See your own codebase, mapped
          </h2>
          <p className="relative mx-auto mt-3 max-w-xl text-sm text-zinc-400">
            Try the live explorer in your browser, or install the extension and point it at any repository.
          </p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/" prefetch={false} className={primaryCta}>
              Open the explorer demo
            </Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={secondaryCta}>
              Get the VS Code extension
            </a>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col items-center justify-between gap-3 border-t border-zinc-900 pt-8 text-xs text-zinc-500 sm:flex-row">
          <Wordmark />
          <p className="font-mono">read-only · source-host-local · no LLM key in-app</p>
        </div>
      </footer>
    </main>
  );
}
