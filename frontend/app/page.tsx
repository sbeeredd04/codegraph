"use client";

import { useEffect, useState } from "react";
import { loadSnapshot, type GraphSnapshot } from "@/lib/graph-data";
import { Explorer } from "@/components/explorer";

// Home = the interactive product: load the snapshot and hand its nodes/edges to
// the Explorer (projection switching, orphan overlay, trace path, node detail).
// Runs against the REAL tRPC benchmark (590 nodes / 1259 edges / 8 packages).
export default function Home() {
  const [snap, setSnap] = useState<GraphSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSnapshot("/benchmark/trpc.json")
      .then(setSnap)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

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
        Loading benchmark&hellip;
      </main>
    );
  }

  return <Explorer nodes={snap.nodes} edges={snap.edges} title={`${snap.root ?? "snapshot"} · ${snap.nodeCount} nodes`} />;
}
