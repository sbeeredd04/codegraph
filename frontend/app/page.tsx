"use client";

import { useEffect, useMemo, useState } from "react";
import { loadSnapshot, type GraphSnapshot } from "@/lib/graph-data";
import { Explorer } from "@/components/explorer";

// The interactive product: load a snapshot and hand its nodes/edges to the
// Explorer (projection switching, orphan overlay, trace path, node detail, and
// the read-only source viewer). Two datasets ship: the large tRPC benchmark for
// scale (graph-only — third-party source isn't bundled), and a first-party
// codegraph self-portrait that carries its own source so the FR-15 code viewer
// works end-to-end on a static/hosted build (AD-16: source stays first-party).
interface Dataset {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  /** Source sidecar base, or null when this dataset ships no source. */
  readonly sourceBase: string | null;
}

// Mount-agnostic URLs (no leading slash) resolve against document.baseURI, so
// the SAME export boots from a web root (baseURI === "/") and from the VS Code
// webview's per-session origin (the panel sets <base href> via asWebviewUri) —
// matching the relative `./_next/` assetPrefix in next.config.ts.
const DATASETS: readonly Dataset[] = [
  { id: "trpc", label: "tRPC · scale", url: "benchmark/trpc.json", sourceBase: null },
  { id: "codegraph", label: "codegraph · source", url: "benchmark/codegraph.json", sourceBase: "benchmark/codegraph.src" },
];

export default function Home() {
  const [datasetId, setDatasetId] = useState<string>(DATASETS[0].id);
  const [snap, setSnap] = useState<GraphSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(
    () => DATASETS.find((d) => d.id === datasetId) ?? DATASETS[0],
    [datasetId],
  );

  useEffect(() => {
    // Only setState inside the async callbacks — no synchronous reset, which
    // would cascade a render. Switching datasets keeps the prior graph on screen
    // until the next snapshot resolves (a local fetch, so effectively instant).
    let cancelled = false;
    loadSnapshot(current.url)
      .then((s) => {
        if (!cancelled) {
          setSnap(s);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [current.url]);

  if (error) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#0e0f13] px-6 text-sm text-red-300">
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3">
          {error}
        </p>
      </main>
    );
  }

  if (!snap) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#0e0f13] text-sm text-zinc-500">
        Loading dataset&hellip;
      </main>
    );
  }

  return (
    <Explorer
      nodes={snap.nodes}
      edges={snap.edges}
      title={`${snap.root ?? "snapshot"} · ${snap.nodeCount} nodes`}
      sourceBase={current.sourceBase}
      datasets={DATASETS}
      datasetId={current.id}
      onDataset={setDatasetId}
    />
  );
}
