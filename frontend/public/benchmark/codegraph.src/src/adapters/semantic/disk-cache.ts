// Disk-backed enrichment cache (Epic 4 / BYOM): the on-disk half of the "no
// re-spend" guarantee. Implements the core EnrichmentCache port by persisting a
// flat { key -> NodeEnrichment } JSON map next to the workspace, loaded lazily
// and written through on every set. Best-effort and crash-proof: a missing,
// corrupt, or read-only file degrades to an empty in-memory cache rather than
// breaking enrichment (local-first, graceful — AD-1 keeps this I/O out of core).

import * as fs from "node:fs";
import * as path from "node:path";
import type { EnrichmentCache, NodeEnrichment } from "../../core/semantic/enrichment.js";

/** Accept only well-formed entries when loading — a hand-edited or partial file
 * must never inject junk into the cache. */
function isEnrichment(v: unknown): v is NodeEnrichment {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.summary === "string" && typeof o.intent === "string" && typeof o.role === "string";
}

/**
 * A content-addressed enrichment cache persisted at `filePath`. The map is
 * loaded once on first access and held in memory; each `set` writes the whole
 * map back through. All disk failures are swallowed so the cache always works as
 * at least an in-memory store.
 */
export function diskEnrichmentCache(filePath: string): EnrichmentCache {
  let store: Map<string, NodeEnrichment> | undefined;

  const load = (): Map<string, NodeEnrichment> => {
    if (store) return store;
    store = new Map();
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (isEnrichment(v)) store.set(k, v);
      }
    } catch {
      // missing or corrupt file → empty cache
    }
    return store;
  };

  const persist = (map: Map<string, NodeEnrichment>): void => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(Object.fromEntries(map), null, 2));
    } catch {
      // read-only FS or similar → stay in-memory only
    }
  };

  return {
    get: (key) => load().get(key),
    set: (key, value) => {
      const map = load();
      map.set(key, value);
      persist(map);
    },
  };
}
