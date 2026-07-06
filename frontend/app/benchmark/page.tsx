import type { Metadata } from "next";
import Link from "next/link";

// FR (T14.6 → corrected T16) benchmark page — the honest, source-blind (AD-14) marketing
// surface for the real-agent benchmark (bench/agent-benchmark). A pure static server
// component: no client JS, inline/CSS visuals only, CSP-friendly.
//
// T16 CORRECTION: the original page led with "your agent miscounts your codebase ~2x".
// A scale re-examination (bench/agent-benchmark/results/scale-probe-t16.md) showed that
// was a SCOPE ARTIFACT — the agent counted the source package (19 modules) correctly;
// codegraph had counted the whole repo incl. tests (37). A capable agent script-counts
// structure accurately on its own (verified on Textualize/rich, 100 files: exact). So the
// page no longer claims a counting win. It leads with codegraph's DEFENSIBLE edge: a
// resolved cross-file graph for RELATIONAL queries the agent can't cheaply reconstruct —
// with the deterministic find_path virtual-dispatch result (T15) as the demonstration.
// Every number here is measured; nothing is inflated.

export const metadata: Metadata = {
  title: "codegraph — the agent benchmark",
  description:
    "We ran a real Claude agent over two Python codebases, with and without codegraph, and " +
    "measured every run. The honest result — including where codegraph doesn't help.",
};

const REPO_URL = "https://github.com/sbeeredd04/codegraph";
const BENCH_URL = `${REPO_URL}/tree/feat/epic1-foundation/bench/agent-benchmark`;

// The demonstration: a resolved call path through a polymorphic interface. codegraph
// returns this in one query; without it the agent reads several files and reasons about
// which adapter is mounted at runtime. The last hop is virtual dispatch.
interface PathHop {
  readonly node: string;
  readonly note: string;
  readonly dispatch?: boolean;
}
const RESOLVED_PATH: readonly PathHop[] = [
  { node: "requests.get", note: "the public entry point" },
  { node: "requests.request", note: "opens a Session" },
  { node: "Session.request", note: "builds + prepares the request" },
  { node: "Session.send", note: "resolves the adapter, calls adapter.send" },
  { node: "BaseAdapter.send", note: "the abstract method a static trace resolves to" },
  { node: "HTTPAdapter.send", note: "the concrete override reached at runtime", dispatch: true },
];

// Counting is NOT codegraph's edge — a capable agent gets it right alone. Shown as an
// honesty signal, not a win. Both figures are independently AST-verified.
interface CountCheck {
  readonly repo: string;
  readonly scope: string;
  readonly truth: string;
  readonly agent: string;
  readonly verdict: string;
}
const COUNT_CHECKS: readonly CountCheck[] = [
  { repo: "Textualize/rich", scope: "100-file package", truth: "100 / 181 / 161 / 751", agent: "100 / 181 / 161 / 751", verdict: "exact" },
  { repo: "psf/requests", scope: "source package", truth: "19 / 52 / 91 / 177", agent: "19 / 52 / 91 / 177", verdict: "exact" },
];

interface TaskRow {
  readonly task: string;
  readonly asks: string;
  readonly baseTurns: number;
  readonly cgTurns: number;
  readonly effect: "resolved" | "even" | "overhead";
  readonly note: string;
}
// Every task run as a real claude -p A/B on psf/requests. Honest verdicts: on a small
// repo the agent handles counting + grep on its own, so codegraph is neutral-to-overhead
// on raw efficiency. Its contribution is certainty on the one relational trace.
const TASKS: readonly TaskRow[] = [
  { task: "call-path", asks: "trace requests.get → HTTPAdapter.send", baseTurns: 7, cgTurns: 8, effect: "resolved", note: "codegraph returns the resolved, polymorphism-aware path; the agent otherwise reconstructs it by reading" },
  { task: "graph-stats", asks: "count the codebase's structure", baseTurns: 6, cgTurns: 4, effect: "even", note: "the agent script-counts the source correctly on its own" },
  { task: "callers", asks: "who calls HTTPAdapter.send", baseTurns: 3, cgTurns: 6, effect: "overhead", note: "grep already answers this on a 37-file repo" },
  { task: "auth-subclasses", asks: "all AuthBase subclasses", baseTurns: 3, cgTurns: 4, effect: "overhead", note: "a small, greppable hierarchy" },
  { task: "dependencies", asks: "first-party imports of sessions.py", baseTurns: 3, cgTurns: 3, effect: "even", note: "one file, read directly" },
  { task: "api-surface", asks: "public verbs in api.py", baseTurns: 4, cgTurns: 3, effect: "even", note: "one file, read directly" },
];

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="inline-block size-3.5 rounded-[4px] bg-gradient-to-br from-violet-400 to-cyan-400" />
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

function Effect({ e }: { e: TaskRow["effect"] }) {
  const map = {
    resolved: { t: "resolved path", c: "text-violet-300 border-violet-500/40 bg-violet-500/10" },
    even: { t: "agent does this alone", c: "text-zinc-300 border-zinc-700 bg-zinc-800/40" },
    overhead: { t: "overhead", c: "text-amber-300/90 border-amber-500/30 bg-amber-500/10" },
  }[e];
  return <span className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${map.c}`}>{map.t}</span>;
}

export default function Benchmark() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/welcome" prefetch={false} className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-5 text-sm text-zinc-400">
          <Link href="/welcome" prefetch={false} className="transition-colors hover:text-zinc-100">Home</Link>
          <Link href="/docs" prefetch={false} className="transition-colors hover:text-zinc-100">Docs</Link>
          <a href={REPO_URL} className="transition-colors hover:text-zinc-100">GitHub</a>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        {/* Hero */}
        <section className="pt-10 pb-14 sm:pt-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-violet-400">Benchmark · real agent runs</p>
          <h1 className="mt-4 max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-50 sm:text-5xl">
            A capable agent already reads your code. codegraph resolves it.
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
            We ran a real Claude agent over <span className="font-mono text-zinc-300">psf/requests</span> and{" "}
            <span className="font-mono text-zinc-300">Textualize/rich</span>, with and without codegraph, and measured
            every run. The honest finding: for counting structure and grepping files, a good agent does fine on its own.
            What it can&apos;t do cheaply is{" "}
            <span className="text-zinc-200">resolve the cross-file relationships</span>{" "}— which concrete method a
            polymorphic call reaches, the full path from an entry point to a write, everything a change touches.
            codegraph precomputes that graph, so the answer is one query and it&apos;s certain.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/welcome" prefetch={false} className={primaryCta}>Get codegraph</Link>
            <a href={BENCH_URL} className={secondaryCta}>Read the raw data</a>
          </div>
        </section>

        {/* The demonstration: a resolved path */}
        <section className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-[#0e0e13] to-[#0a0a0d] p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-zinc-50">The one query grep can&apos;t answer</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            &ldquo;How does <span className="font-mono text-zinc-300">requests.get()</span>{" "}reach the code that
            actually sends the request?&rdquo; The call goes through a polymorphic interface:{" "}
            <span className="font-mono text-zinc-300">Session.send</span> calls{" "}
            <span className="font-mono text-zinc-300">adapter.send</span>, which a static trace resolves to the{" "}
            <span className="text-zinc-200">abstract</span> base method — not the concrete override reached at runtime.
            codegraph models the override and resolves the dispatch, returning the whole path in one call.
          </p>
          <ol className="mt-6 space-y-0">
            {RESOLVED_PATH.map((hop, i) => (
              <li key={hop.node} className="flex gap-3" data-testid={`hop-${i}`}>
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={`mt-1 size-2.5 shrink-0 rounded-full ${hop.dispatch ? "bg-violet-400 ring-4 ring-violet-500/20" : "bg-zinc-600"}`}
                  />
                  {i < RESOLVED_PATH.length - 1 && <span aria-hidden className="my-0.5 w-px flex-1 bg-zinc-700" />}
                </div>
                <div className="pb-4">
                  <div className="font-mono text-[13px] text-zinc-100">
                    {hop.dispatch && <span className="mr-1.5 text-violet-300">⟿ virtual dispatch →</span>}
                    {hop.node}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400">{hop.note}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 rounded-xl border border-zinc-800 bg-[#0d0d11] px-4 py-3 text-xs leading-relaxed text-zinc-400">
            <span className="font-mono text-zinc-300">find_path(requests.get → HTTPAdapter.send)</span> returns this path.
            Before codegraph modeled overrides it returned <span className="text-amber-300">no path</span> — the trace
            dead-ended at the abstract base. That fix is deterministic and verifiable: <span className="text-violet-300">
            found:false → found:true</span> on the indexed repo, no agent, no variance.
          </p>
        </section>

        {/* Honesty: what a capable agent already does well */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-zinc-50">What we tested and dropped</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            An earlier version of this page claimed the agent miscounts a codebase&apos;s structure roughly 2× without
            codegraph. We re-tested it and it doesn&apos;t hold. A capable agent script-counts structure accurately —
            exactly, on both repos. The earlier &ldquo;miscount&rdquo; was a <span className="text-zinc-200">scope
            artifact</span>: the agent had counted the source package while codegraph counted the whole repo including
            tests. Different denominators, not an accuracy gap. A benchmark that only flatters you isn&apos;t telling you
            anything, so we cut the claim.
          </p>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Structural counts: independent ground truth versus the codegraph-free agent</caption>
              <thead>
                <tr className="border-b border-zinc-800 bg-[#0d0d11] text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="px-4 py-3 font-medium">Repo · scope</th>
                  <th scope="col" className="px-4 py-3 font-medium">Ground truth (AST)</th>
                  <th scope="col" className="px-4 py-3 font-medium">Agent, no codegraph</th>
                  <th scope="col" className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {COUNT_CHECKS.map((c) => (
                  <tr key={c.repo} data-testid={`count-${c.repo}`}>
                    <td className="px-4 py-3">
                      <div className="font-mono text-[13px] text-zinc-100">{c.repo}</div>
                      <div className="mt-0.5 text-xs text-zinc-400">{c.scope}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{c.truth}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{c.agent}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 text-[11px] font-medium text-zinc-300">{c.verdict}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-zinc-500">Counts are modules / classes / functions / methods, independently verified with a Python AST pass.</p>
        </section>

        {/* Full per-task table */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-zinc-50">Every task, nothing hidden</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Six comprehension tasks on <span className="font-mono text-zinc-300">psf/requests</span>, each a real agent
            A/B (turns are tool round-trips; fewer is better). On a 37-file repo the agent greps and counts on its own,
            so codegraph is neutral-to-overhead on raw efficiency — its contribution is the one relational trace it
            returns resolved and certain. That gap is what should widen as codebases outgrow what fits in context.
          </p>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Per-task benchmark results: baseline versus codegraph</caption>
              <thead>
                <tr className="border-b border-zinc-800 bg-[#0d0d11] text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="px-4 py-3 font-medium">Task</th>
                  <th scope="col" className="px-4 py-3 font-medium">Turns b→cg</th>
                  <th scope="col" className="px-4 py-3 font-medium">codegraph&apos;s effect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {TASKS.map((t) => (
                  <tr key={t.task} data-testid={`task-${t.task}`} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-[13px] text-zinc-100">{t.task}</div>
                      <div className="mt-0.5 text-xs text-zinc-400">{t.asks}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{t.baseTurns} → {t.cgTurns}</td>
                    <td className="px-4 py-3">
                      <Effect e={t.effect} />
                      <div className="mt-1 max-w-xs text-xs text-zinc-500">{t.note}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Method + what's next */}
        <section className="mt-12 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-[#0d0d11] p-6">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-zinc-50">
              <svg viewBox="0 0 24 24" className="size-4 text-violet-300" {...stroke} aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              How we measured
            </h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-400">
              <li>A real headless Claude agent (<span className="font-mono text-zinc-300">claude -p</span>), same model both sides.</li>
              <li>Baseline runs on a codegraph-free copy (file tools only); codegraph runs with the MCP server attached.</li>
              <li>Structural counts checked against an independent Python AST pass — never against codegraph.</li>
              <li>Turns, tokens, time, and cost captured from the run telemetry — fully reproducible.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-[#0d0d11] p-6">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-zinc-50">
              <svg viewBox="0 0 24 24" className="size-4 text-amber-300" {...stroke} aria-hidden>
                <path d="M12 3v10M12 17h.01" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              What we haven&apos;t proven yet
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Both repos here are small enough to fit in an agent&apos;s context, which is exactly where codegraph helps
              least. The claim that a resolved graph pulls ahead at scale — a codebase of thousands of files, deep
              relational questions grep can&apos;t close — is <span className="text-zinc-200">not demonstrated here</span>,
              and we won&apos;t pretend it is. A large-repo run is the honest next test. Same for cross-file inheritance:
              override resolution works within a file today; imported base classes need the language server, which is the
              next slice.
            </p>
          </div>
        </section>

        {/* Reproduce */}
        <section className="mt-12 rounded-2xl border border-zinc-800 bg-[#0d0d11] p-6 sm:flex sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-zinc-50">Run it yourself</h2>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              The harness, tasks, ground-truth keys, raw per-run results, and the scale probe all live in the repo. Point
              it at any indexed codebase and reproduce every number on this page.
            </p>
          </div>
          <a href={BENCH_URL} className={`${secondaryCta} mt-4 sm:mt-0`}>bench/agent-benchmark ↗</a>
        </section>
      </main>
    </div>
  );
}
