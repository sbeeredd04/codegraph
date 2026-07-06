import type { Metadata } from "next";
import Link from "next/link";

// FR (T14.6) benchmark page — the honest, source-blind (AD-14) marketing surface
// that reports the real-agent benchmark (bench/agent-benchmark). Its own route
// (`/benchmark`); the explorer keeps `/`. A pure static server component: no client
// JS, inline/CSS visuals only, so it stays CSP-friendly and fast. Every number here
// is the measured result — nothing is inflated (see bench/agent-benchmark/findings.md).
// Mount-agnostic root-relative links so the export resolves under any origin.

export const metadata: Metadata = {
  title: "codegraph — the agent benchmark",
  description:
    "We ran a real Claude agent over a Python codebase with and without codegraph. " +
    "Without it, the agent's model of the code was measurably wrong. The honest data.",
};

const REPO_URL = "https://github.com/sbeeredd04/codegraph";
const BENCH_URL = `${REPO_URL}/tree/feat/epic1-foundation/bench/agent-benchmark`;

// The headline finding: asked to count the codebase's structure, the codegraph-free
// agent undercounted badly (it "saw" roughly half the code). codegraph = ground truth.
interface Count {
  readonly label: string;
  readonly guessed: number; // the baseline agent's wrong answer
  readonly actual: number; // the real count (codegraph / AST truth)
}
const MISCOUNT: readonly Count[] = [
  { label: "modules", guessed: 19, actual: 37 },
  { label: "classes", guessed: 52, actual: 72 },
  { label: "functions", guessed: 91, actual: 173 },
  { label: "methods", guessed: 177, actual: 475 },
];

interface TaskRow {
  readonly task: string;
  readonly asks: string;
  readonly baseTurns: number;
  readonly baseOk: boolean;
  readonly cgTurns: number;
  readonly cgOk: boolean;
  readonly verdict: "codegraph" | "tie" | "overhead";
}
// Every task run as a real `claude -p` agent twice — a codegraph-free repo copy vs an
// indexed copy + the codegraph MCP — graded against a source-derived key. Honest mix.
const TASKS: readonly TaskRow[] = [
  { task: "graph-stats", asks: "count the whole codebase's structure", baseTurns: 6, baseOk: false, cgTurns: 4, cgOk: true, verdict: "codegraph" },
  { task: "callers", asks: "who calls HTTPAdapter.send", baseTurns: 3, baseOk: true, cgTurns: 6, cgOk: true, verdict: "overhead" },
  { task: "auth-subclasses", asks: "all AuthBase subclasses", baseTurns: 3, baseOk: true, cgTurns: 4, cgOk: true, verdict: "overhead" },
  { task: "call-path", asks: "path requests.get → adapter.send", baseTurns: 7, baseOk: true, cgTurns: 8, cgOk: true, verdict: "tie" },
  { task: "dependencies", asks: "first-party imports of sessions.py", baseTurns: 3, baseOk: true, cgTurns: 3, cgOk: true, verdict: "tie" },
  { task: "api-surface", asks: "public verbs in api.py", baseTurns: 4, baseOk: true, cgTurns: 3, cgOk: true, verdict: "tie" },
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

/** A labelled comparison bar: the agent's guess (muted) against the real count (violet),
 *  both scaled to the real count. The percentage names how much the agent actually saw. */
function CountBars({ c }: { c: Count }) {
  const pct = Math.round((c.guessed / c.actual) * 100);
  return (
    <div className="space-y-1.5" data-testid={`miscount-${c.label}`}>
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span className="text-zinc-300">{c.label}</span>
        <span className="text-zinc-500">
          saw <span className="text-amber-300">{c.guessed}</span> of{" "}
          <span className="text-violet-300">{c.actual}</span> · {pct}%
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-zinc-800/70">
        {/* the truth track (full width) */}
        <div className="absolute inset-y-0 left-0 w-full rounded-full bg-violet-500/25" />
        {/* what the codegraph-free agent actually counted */}
        <div className="absolute inset-y-0 left-0 rounded-full bg-amber-400/80" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatCard({ value, label, tone = "neutral" }: { value: string; label: string; tone?: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-violet-300" : tone === "bad" ? "text-amber-300" : "text-zinc-100";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0d0d11] px-5 py-4">
      <div className={`font-display text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-xs leading-relaxed text-zinc-400">{label}</div>
    </div>
  );
}

function Verdict({ v }: { v: TaskRow["verdict"] }) {
  const map = {
    codegraph: { t: "codegraph wins", c: "text-violet-300 border-violet-500/40 bg-violet-500/10" },
    tie: { t: "tie", c: "text-zinc-300 border-zinc-700 bg-zinc-800/40" },
    overhead: { t: "overhead", c: "text-amber-300/90 border-amber-500/30 bg-amber-500/10" },
  }[v];
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${map.c}`}>{map.t}</span>;
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
            Your agent is guessing at your codebase. codegraph makes it certain.
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
            We ran a real Claude agent over the{" "}
            <span className="font-mono text-zinc-300">psf/requests</span>{" "}library twice — once with only file
            tools, once with codegraph — and measured every run. Asked to describe the
            codebase&apos;s structure, the agent <span className="text-zinc-200">without</span> codegraph got it{" "}
            <span className="text-amber-300">measurably wrong</span>. That is the hidden tax of an agent that reads a few
            files and infers the rest.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/welcome" prefetch={false} className={primaryCta}>Get codegraph</Link>
            <a href={BENCH_URL} className={secondaryCta}>Read the raw data</a>
          </div>
        </section>

        {/* The headline miscount */}
        <section className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-[#0e0e13] to-[#0a0a0d] p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-zinc-50">The agent saw about half the code</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            One task simply asked how many modules, classes, functions, and methods the codebase has. Without codegraph
            the agent read a handful of files and extrapolated — landing roughly <span className="text-amber-300">2×
            short</span>, and spending more time and money to get there. With codegraph it read the graph and answered
            exactly. An agent acting on a half-wrong map makes half-wrong changes.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {MISCOUNT.map((c) => (
              <CountBars key={c.label} c={c} />
            ))}
          </div>
          <p className="mt-5 text-xs text-zinc-500">
            <span className="text-amber-300">Amber</span> = what the codegraph-free agent counted ·{" "}
            <span className="text-violet-300">violet track</span> = the real count codegraph reports.
          </p>
        </section>

        {/* Aggregate */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-zinc-50">The honest bottom line</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Across six comprehension tasks, codegraph&apos;s edge is <span className="text-zinc-200">correctness</span>,
            not raw speed. It fixed the one task the agent otherwise got wrong. On a tiny 37-file repo, a strong model
            already greps local questions efficiently — so codegraph added overhead on some targeted lookups. That gap
            is exactly what closes as codebases grow past what a model can hold in its head.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatCard value="5 → 6 / 6" label="tasks answered correctly (baseline → codegraph). codegraph fixed the structural miscount." tone="good" />
            <StatCard value="2× → exact" label="the whole-codebase structure question: ~2× off without codegraph, exact with it." tone="good" />
            <StatCard value="small repo" label="requests is 37 files. The advantage compounds with scale, where grep stops fitting in context." tone="neutral" />
          </div>
        </section>

        {/* Full transparent table */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold text-zinc-50">Every task, nothing hidden</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Turns are agent tool round-trips (fewer is better). We show where codegraph won, tied, and cost more — the
            whole point of a benchmark is the parts that don&apos;t flatter you.
          </p>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Per-task benchmark results: baseline versus codegraph</caption>
              <thead>
                <tr className="border-b border-zinc-800 bg-[#0d0d11] text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="px-4 py-3 font-medium">Task</th>
                  <th scope="col" className="px-4 py-3 font-medium">Baseline</th>
                  <th scope="col" className="px-4 py-3 font-medium">codegraph</th>
                  <th scope="col" className="px-4 py-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {TASKS.map((t) => (
                  <tr key={t.task} data-testid={`task-${t.task}`} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-[13px] text-zinc-100">{t.task}</div>
                      <div className="mt-0.5 text-xs text-zinc-400">{t.asks}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {t.baseTurns} turns · {t.baseOk ? <span className="text-zinc-300">correct</span> : <span className="text-amber-300">wrong</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {t.cgTurns} turns · {t.cgOk ? <span className="text-violet-300">correct</span> : <span className="text-amber-300">wrong</span>}
                    </td>
                    <td className="px-4 py-3"><Verdict v={t.verdict} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Method + honesty */}
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
              <li>Answers graded against a key derived from the <span className="text-zinc-200">source</span>, not from codegraph.</li>
              <li>Turns, tokens, time, and cost captured from the run telemetry — fully reproducible.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-[#0d0d11] p-6">
            <h3 className="flex items-center gap-2 font-display text-base font-semibold text-zinc-50">
              <svg viewBox="0 0 24 24" className="size-4 text-amber-300" {...stroke} aria-hidden>
                <path d="M12 3v10M12 17h.01" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              What we&apos;re still fixing
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              The benchmark caught a real gap — tracing a call through a polymorphic interface (an abstract method with
              concrete overrides) — and we fixed it. codegraph now models override edges and resolves virtual dispatch,
              so <span className="font-mono text-zinc-300">requests.get → HTTPAdapter.send</span> traces end to end where
              it used to return <span className="text-zinc-200">no path</span> — and call-path dropped from 10 to 8
              turns. What&apos;s left is honest: this resolves inheritance <span className="text-zinc-200">within a
              file</span>; a base class imported from another module needs cross-file type resolution, the next slice.
              A benchmark you can&apos;t lose isn&apos;t telling you anything.
            </p>
          </div>
        </section>

        {/* Reproduce */}
        <section className="mt-12 rounded-2xl border border-zinc-800 bg-[#0d0d11] p-6 sm:flex sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-zinc-50">Run it yourself</h2>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              The harness, tasks, ground-truth keys, and raw per-run results live in the repo. Point it at any indexed
              codebase and reproduce every number on this page.
            </p>
          </div>
          <a href={BENCH_URL} className={`${secondaryCta} mt-4 sm:mt-0`}>bench/agent-benchmark ↗</a>
        </section>
      </main>
    </div>
  );
}
