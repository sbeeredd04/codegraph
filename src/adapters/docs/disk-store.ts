// Disk-backed doc store (Epic 7 / FR-29 companion to the diagram store): the
// on-disk half of the agent-authored docs loop. Implements the core DocStore port
// by persisting a versioned DocSet as JSON, loaded lazily and written through on
// every change — the shared repoJsonStore factory (FR-44) carries the lazy-load +
// crash-proof write-through; here we thread the doc set's pure operations. Loads
// tolerantly via parseDocSet (malformed entries dropped), and degrades to an
// in-memory set on a missing/corrupt/read-only file rather than breaking the tools
// (local-first, graceful — AD-1 keeps this I/O out of core). The Markdown it stores
// is agent-written and UNTRUSTED; it is length-capped by validateDoc on write and
// sanitized at the render edge.

import { emptyDocSet, parseDocSet, upsertDoc, removeDoc, type DocStore } from "../../core/docs/doc.js";
import { repoJsonStore } from "../store/repo-json-store.js";

/** A doc store persisted at `filePath`. The set is loaded once on first access
 * and held in memory; each change writes the whole set back through. All disk
 * failures are swallowed so the store always works as at least in-memory. */
export function diskDocStore(filePath: string): DocStore {
  return repoJsonStore(filePath, {
    parse: parseDocSet,
    empty: emptyDocSet,
    upsert: upsertDoc,
    removeFrom: removeDoc,
    items: (set) => set.docs,
  });
}
