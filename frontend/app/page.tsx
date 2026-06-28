"use client";

import { useEffect, useState } from "react";
import {
  loadSnapshot,
  computeStats,
  KIND_COLORS,
  type GraphSnapshot,
  type GraphStats,
} from "@/lib/graph-data";

// Foundation page: proves the data pipeline end-to-end against the REAL tRPC
// benchmark (590 nodes / 1259 edges across 7 packages), reusing the core's
// GraphSnapshot type. The branded UI + interactive graph canvas land on top of
// this once the Better Design system is wired (this is deliberately neutral).
export default function Home() {
  const [snap, setSnap] = useState<GraphSnapshot | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSnapshot("/benchmark/trpc.json")
      .then((s) => {
        setSnap(s);
        setStats(computeStats(s));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="min-h-screen bg-[#0e0f13] px-6 py-10 font-sans text-zinc-200 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-baseline gap-3">
          <span
            aria-hidden
            className="inline-block size-3.5 rounded-[4px] bg-gradient-to-br from-violet-400 to-cyan-400"
          />
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">codegraph</h1>
          <span className="text-sm text-zinc-500">
            knowledge graph &middot; web frontend (foundation)
          </span>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        {!snap && !error && (
          <p className="text-sm text-zinc-500">Loading benchmark&hellip;</p>
        )}

        {snap && stats && (
          <section className="flex flex-col gap-8">
            <div className="text-sm text-zinc-400">
              Benchmark:{" "}
              <span className="font-medium text-zinc-200">{snap.root ?? "snapshot"}</span> &middot;{" "}
              {stats.packages.length} packages
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Nodes" value={stats.nodeCount} />
              <Stat label="Edges" value={stats.edgeCount} />
              <Stat label="Packages" value={stats.packages.length} />
              <Stat label="Modules" value={stats.byKind.module ?? 0} />
            </div>

            <Panel title="Nodes by kind">
              <div className="flex flex-col gap-2.5">
                {Object.entries(stats.byKind)
                  .sort((a, b) => b[1] - a[1])
                  .map(([kind, count]) => (
                    <Bar
                      key={kind}
                      label={kind}
                      count={count}
                      max={stats.nodeCount}
                      color={KIND_COLORS[kind as keyof typeof KIND_COLORS] ?? "#8b93a7"}
                    />
                  ))}
              </div>
            </Panel>

            <Panel title="Nodes by package">
              <div className="flex flex-col gap-2.5">
                {stats.packages.map((p) => (
                  <Bar
                    key={p.name}
                    label={p.name}
                    count={p.count}
                    max={stats.packages[0].count}
                    color="#7c8aff"
                  />
                ))}
              </div>
            </Panel>

            <Panel title="Edges by type">
              <div className="flex flex-wrap gap-3">
                {Object.entries(stats.byEdgeType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <span
                      key={type}
                      className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300"
                    >
                      {type} <span className="font-mono text-zinc-500">{count}</span>
                    </span>
                  ))}
              </div>
            </Panel>

            <p className="text-xs leading-relaxed text-zinc-600">
              Foundation scaffold &mdash; the branded interface, interactive graph canvas, knowledge
              index, and diagram views are built on top of this once the design system is wired.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="font-mono text-2xl font-semibold text-zinc-50">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}

function Bar({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 shrink-0 truncate font-mono text-xs text-zinc-300">{label}</div>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="w-12 shrink-0 text-right font-mono text-xs text-zinc-400">{count}</div>
    </div>
  );
}
