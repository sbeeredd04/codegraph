"use client";

import { useEffect, useMemo, useState } from "react";
import { loadSnapshot, type GraphSnapshot } from "@/lib/graph-data";
import { isWebviewHost, subscribeToSnapshot } from "@/lib/webview-bridge";
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
  // True once the graph arrived live from the VS Code webview host — then the
  // sample dataset switcher and the bundled source sidecar no longer apply.
  const [live, setLive] = useState(false);
  // Absolute repo root the host sends alongside a live snapshot, for "open in
  // editor" deep links (FR-32). Transport-only; never present on the web/cloud.
  const [editorRoot, setEditorRoot] = useState<string | null>(null);

  const current = useMemo(
    () => DATASETS.find((d) => d.id === datasetId) ?? DATASETS[0],
    [datasetId],
  );

  useEffect(() => {
    // Inside the VS Code webview the host posts the live graph; on the standalone
    // web we fetch a bundled sample. setState happens only in the async callbacks
    // / event handlers below — never synchronously here (the React-compiler rule
    // forbids it, and a synchronous reset would cascade a render anyway).
    if (isWebviewHost()) {
      return subscribeToSnapshot(({ snapshot, editorRoot: root }) => {
        setSnap(snapshot);
        setEditorRoot(root ?? null);
        setError(null);
        setLive(true);
      });
    }
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
      diagrams={snap.diagrams}
      docs={snap.docs}
      // AI-assist (FR-30) is a local-plane affordance: the user's own agent does
      // the work. Withheld on the source-blind cloud demo, where there's no
      // connected agent — flagged at build time via NEXT_PUBLIC_CODEGRAPH_CLOUD.
      assistEnabled={process.env.NEXT_PUBLIC_CODEGRAPH_CLOUD !== "1"}
      // Editor deep-linking (FR-32) lights up only when the host posts its
      // absolute root — i.e. inside the VS Code webview, never on the cloud demo.
      editorRoot={editorRoot}
      title={`${snap.root ?? "snapshot"} · ${snap.nodeCount} nodes`}
      // Live (webview) graphs carry no bundled source sidecar and have no sample
      // datasets to switch between, so both affordances are withheld.
      sourceBase={live ? null : current.sourceBase}
      datasets={live ? undefined : DATASETS}
      datasetId={current.id}
      onDataset={setDatasetId}
    />
  );
}
